import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  LoginThrottle,
  type EstadoDoBalde,
} from '../../../application/ports/login-throttle.port';
import {
  lerEscada,
  type DegrauDaEscada,
} from '../../../domain/auth/lockout-policy';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type LinhaDoBalde = {
  falhas: number;
  bloqueado_ate: Date | null;
  registrou: number;
};

/**
 * Janela deslizante do lockout em Postgres (Fase 7a, item 2).
 *
 * Segue a mesma forma do `RateLimitGuard`: INSERT e COUNT num statement só,
 * por CTE. Duas consultas separadas deixariam duas tentativas concorrentes
 * lerem a contagem antes de a outra inserir, e as duas passariam.
 *
 * ## A soma explícita não é redundância
 *
 * Em Postgres a linha inserida por uma CTE de escrita **não é visível** para o
 * resto do mesmo statement: o SELECT enxerga o snapshot de antes. Aqui isso é
 * duplamente proposital, porque as duas coisas que o statement devolve querem
 * recortes OPOSTOS:
 *
 * - `bloqueado_ate` sai do estado ANTERIOR — ninguém pode ser bloqueado pela
 *   própria requisição atual, e é o mesmo valor que governa o portão do
 *   INSERT;
 * - `falhas` inclui a tentativa de agora, para o chamador saber que foi esta
 *   que estourou o limite.
 *
 * Um statement, dois recortes, resolvidos pela soma de
 * `(select count(*) from novo)` só na contagem.
 *
 * ## Duas escadas
 *
 * O balde de IP tem limiar próprio, muito mais alto. Um único limiar para os
 * dois seria errado nas duas pontas: 5 tentativas por IP derrubaria qualquer
 * escritório atrás de NAT, e 20 por conta seria generoso demais para um
 * ataque de senha. Além disso o teto do IP é curto (2 min), porque ali o dano
 * colateral atinge quem não fez nada.
 */
@Injectable()
export class DrizzleLoginThrottle extends LoginThrottle {
  private readonly janelaMs = Number(
    process.env.AUTH_LOCKOUT_WINDOW_MS ?? 900_000,
  );
  private readonly escadaEmail: DegrauDaEscada[] = lerEscada(
    process.env.AUTH_LOCKOUT_THRESHOLDS,
  );
  private readonly escadaIp: DegrauDaEscada[] = lerEscada(
    process.env.AUTH_LOCKOUT_IP_THRESHOLDS ?? '20:30,30:120',
  );
  private readonly habilitado = process.env.AUTH_LOCKOUT_ENABLED !== 'false';

  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async registrarEContar(bucketKey: string): Promise<EstadoDoBalde> {
    if (!this.habilitado) return LIBERADO;
    const db = currentDb(this.rootDb);

    const resultado = await db.execute<LinhaDoBalde>(sql`
      with janela as (
        select count(*)::int    as falhas,
               max(occurred_at) as ultima_falha
          from auth_lockout_hits
         where bucket_key = ${bucketKey}
           and occurred_at > now() - make_interval(secs => ${this.janelaSegundos()}::int)
      ),
      estado as (
        select falhas,
               ultima_falha + make_interval(secs => ${this.escadaEmSql(bucketKey)}::int)
                 as bloqueado_ate
          from janela
      ),
      novo as (
        insert into auth_lockout_hits (bucket_key)
        select ${bucketKey} from estado
         where bloqueado_ate is null or bloqueado_ate <= now()
        returning 1 as inserido
      )
      select (select falhas from estado)::int
               + (select count(*) from novo)::int as falhas,
             (select bloqueado_ate from estado)   as bloqueado_ate,
             (select count(*) from novo)::int     as registrou
    `);

    return montar(linhaDe(resultado));
  }

  async consultar(bucketKey: string): Promise<EstadoDoBalde> {
    if (!this.habilitado) return LIBERADO;
    const db = currentDb(this.rootDb);

    const resultado = await db.execute<LinhaDoBalde>(sql`
      with janela as (
        select count(*)::int    as falhas,
               max(occurred_at) as ultima_falha
          from auth_lockout_hits
         where bucket_key = ${bucketKey}
           and occurred_at > now() - make_interval(secs => ${this.janelaSegundos()}::int)
      )
      select falhas,
             ultima_falha + make_interval(secs => ${this.escadaEmSql(bucketKey)}::int)
               as bloqueado_ate,
             0 as registrou
        from janela
    `);

    return montar(linhaDe(resultado));
  }

  async limpar(bucketKey: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.execute(sql`
      delete from auth_lockout_hits where bucket_key = ${bucketKey}
    `);
  }

  private janelaSegundos(): number {
    return Math.max(1, Math.ceil(this.janelaMs / 1000));
  }

  /**
   * A escada como um CASE do SQL, para o portão do INSERT e a duração do
   * bloqueio saírem do MESMO snapshot da contagem.
   *
   * Os `::int` não são decoração: o driver manda todo parâmetro como texto, e
   * um CASE cujos ramos são todos texto tem tipo texto — aí
   * `make_interval(secs => <texto>)` não resolve nenhuma assinatura e o
   * Postgres recusa o statement inteiro.
   */
  private escadaEmSql(bucketKey: string) {
    const escada = bucketKey.startsWith('ip:')
      ? this.escadaIp
      : this.escadaEmail;

    let expressao = sql`case`;
    for (const degrau of [...escada].reverse()) {
      expressao = sql`${expressao} when falhas >= ${degrau.falhas}::int then ${degrau.segundos}::int`;
    }
    return sql`(${expressao} else null end)`;
  }
}

const LIBERADO: EstadoDoBalde = {
  falhas: 0,
  bloqueadoAte: null,
  registrou: false,
};

function montar(linha: LinhaDoBalde | undefined): EstadoDoBalde {
  const bruta = linha?.bloqueado_ate ?? null;
  const bloqueadoAte = bruta ? new Date(bruta) : null;

  return {
    falhas: Number(linha?.falhas ?? 0),
    // Só conta como bloqueio se ainda não passou. O SQL devolve o instante
    // calculado mesmo quando já venceu — comparar aqui evita um segundo
    // `now()` dentro da consulta, que veria um instante diferente do desta
    // linha de código.
    bloqueadoAte:
      bloqueadoAte && bloqueadoAte.getTime() > Date.now() ? bloqueadoAte : null,
    registrou: Number(linha?.registrou ?? 0) === 1,
  };
}

function linhaDe<T>(resultado: unknown): T | undefined {
  return (resultado as { rows?: T[] }).rows?.[0];
}
