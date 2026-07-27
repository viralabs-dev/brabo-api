import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  LoginThrottle,
  type EstadoDoBalde,
} from '../../../application/ports/login-throttle.port';
import {
  bloqueadoAte,
  lerEscada,
  type DegrauDaEscada,
} from '../../../domain/auth/lockout-policy';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type LinhaDoBalde = {
  falhas: number;
  ultima_falha: Date | null;
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
 * duplamente proposital — o PORTÃO do insert precisa ser avaliado contra o
 * estado ANTERIOR (ninguém pode ser bloqueado pela própria requisição atual),
 * enquanto a CONTAGEM devolvida precisa incluir a tentativa de agora (para o
 * chamador saber que foi esta que estourou o limite). Um statement, duas
 * necessidades opostas, resolvidas pela soma de `(select count(*) from novo)`.
 */
@Injectable()
export class DrizzleLoginThrottle extends LoginThrottle {
  private readonly janelaMs = Number(
    process.env.AUTH_LOCKOUT_WINDOW_MS ?? 900_000,
  );
  private readonly escada: DegrauDaEscada[] = lerEscada(
    process.env.AUTH_LOCKOUT_THRESHOLDS,
  );
  private readonly habilitado = process.env.AUTH_LOCKOUT_ENABLED !== 'false';

  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async registrarEContar(bucketKey: string): Promise<EstadoDoBalde> {
    if (!this.habilitado) return LIBERADO;
    const db = currentDb(this.rootDb);
    const janelaSegundos = Math.max(1, Math.ceil(this.janelaMs / 1000));

    // O portão do INSERT reproduz a escada em SQL. Fazer o gate em TS exigiria
    // ler antes e escrever depois — duas idas ao banco e uma janela de corrida
    // no meio, que é o que a CTE existe para fechar.
    const escadaSql = this.escadaEmSql();

    const resultado = await db.execute<LinhaDoBalde>(sql`
      with janela as (
        select count(*)::int    as falhas,
               max(occurred_at) as ultima_falha
          from auth_lockout_hits
         where bucket_key = ${bucketKey}
           and occurred_at > now() - make_interval(secs => ${janelaSegundos}::int)
      ),
      estado as (
        select falhas,
               ultima_falha,
               ultima_falha + make_interval(secs => ${escadaSql}::int) as bloqueado_ate
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
             (select ultima_falha from estado)    as ultima_falha,
             (select count(*) from novo)::int     as registrou
    `);

    return this.montar(linhaDe(resultado));
  }

  async consultar(bucketKey: string): Promise<EstadoDoBalde> {
    if (!this.habilitado) return LIBERADO;
    const db = currentDb(this.rootDb);
    const janelaSegundos = Math.max(1, Math.ceil(this.janelaMs / 1000));

    const resultado = await db.execute<LinhaDoBalde>(sql`
      select count(*)::int    as falhas,
             max(occurred_at) as ultima_falha,
             0                as registrou
        from auth_lockout_hits
       where bucket_key = ${bucketKey}
         and occurred_at > now() - make_interval(secs => ${janelaSegundos})
    `);

    return this.montar(linhaDe(resultado));
  }

  async limpar(bucketKey: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.execute(sql`
      delete from auth_lockout_hits where bucket_key = ${bucketKey}
    `);
  }

  /**
   * A escada como um CASE do SQL, para o portão do INSERT e o cálculo do
   * bloqueio saírem do MESMO snapshot da contagem.
   *
   * Os `::int` não são decoração: o driver manda todo parâmetro como texto, e
   * um CASE cujos ramos são todos texto tem tipo texto — aí
   * `make_interval(secs => <texto>)` não resolve nenhuma assinatura e o
   * Postgres recusa o statement inteiro.
   */
  private escadaEmSql() {
    let expressao = sql`case`;
    for (const degrau of [...this.escada].reverse()) {
      expressao = sql`${expressao} when falhas >= ${degrau.falhas}::int then ${degrau.segundos}::int`;
    }
    return sql`(${expressao} else null end)`;
  }

  private montar(linha: LinhaDoBalde | undefined): EstadoDoBalde {
    const falhas = Number(linha?.falhas ?? 0);
    const registrou = Number(linha?.registrou ?? 0) === 1;
    const bruta = linha?.ultima_falha ?? null;

    // Quando o hit ENTROU, a última falha passa a ser agora — e o snapshot da
    // CTE ainda não a enxerga (a linha da CTE de escrita é invisível para o
    // resto do statement). Sem esta correção, o bloqueio seria contado a
    // partir da penúltima tentativa e sairia curto demais.
    const ultimaFalha = registrou
      ? new Date()
      : bruta
        ? new Date(bruta)
        : null;

    return {
      falhas,
      bloqueadoAte: bloqueadoAte(falhas, ultimaFalha, this.escada),
      registrou,
    };
  }
}

const LIBERADO: EstadoDoBalde = {
  falhas: 0,
  bloqueadoAte: null,
  registrou: false,
};

function linhaDe<T>(resultado: unknown): T | undefined {
  return (resultado as { rows?: T[] }).rows?.[0];
}
