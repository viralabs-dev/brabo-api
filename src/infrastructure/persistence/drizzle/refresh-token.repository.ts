import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  RefreshTokenRepository,
  type MotivoDeRevogacao,
  type NovoRefresh,
  type RefreshTravado,
} from '../../../application/ports/refresh-token-repository.port';
import { classificar } from '../../../domain/auth/refresh-token';
import { refreshTokens } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type LinhaTravada = {
  id: string;
  user_id: string;
  family_id: string;
  rotated_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date;
  family_started_at: Date;
};

@Injectable()
export class DrizzleRefreshTokenRepository extends RefreshTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  /**
   * Trava a linha e classifica a partir do estado COMMITADO.
   *
   * ## Por que `for update`, e não a CTE do rate limit
   *
   * A tentação é copiar o INSERT+COUNT em CTE do `RateLimitGuard`. Aqui isso
   * seria um erro sutil e grave: numa CTE, o `select` que classifica e o
   * `update` que consome enxergam o MESMO snapshot pré-statement. O PERDEDOR
   * de uma corrida veria `rotated_at is null` (estado velho) e concluiria
   * "token ativo que misteriosamente não atualizou" — o reuso passaria batido,
   * que é exatamente o bug que a CTE teria vindo consertar.
   *
   * Com `for update`, o perdedor BLOQUEIA; quando o vencedor commita, o
   * Postgres reavalia o qualificador contra a versão nova da linha e devolve
   * `rotated_at` preenchido. A classificação lê a verdade, não um fantasma.
   *
   * ## Isolamento
   *
   * READ COMMITTED (o default, que é o que `db.transaction()` dá). NÃO subir
   * para REPEATABLE READ: ali a corrida vira erro de serialização (40001), ou
   * seja, 500 para o usuário em vez de um desfecho classificável — e o retry
   * releria num snapshot novo e bifurcaria a família assim mesmo.
   */
  async travarEClassificar(
    tokenHash: string,
    tetoAbsolutoMs: number,
  ): Promise<RefreshTravado | null> {
    const db = currentDb(this.rootDb);

    const resultado = await db.execute<LinhaTravada>(sql`
      select id, user_id, family_id, rotated_at, revoked_at,
             expires_at, family_started_at
        from refresh_tokens
       where token_hash = ${tokenHash}
         for update
    `);

    const linha = (resultado as unknown as { rows?: LinhaTravada[] }).rows?.[0];
    if (!linha) return null;

    return {
      id: linha.id,
      userId: linha.user_id,
      familyId: linha.family_id,
      familyStartedAt: new Date(linha.family_started_at),
      classificacao: classificar(
        {
          rotatedAt: linha.rotated_at ? new Date(linha.rotated_at) : null,
          revokedAt: linha.revoked_at ? new Date(linha.revoked_at) : null,
          expiresAt: new Date(linha.expires_at),
          familyStartedAt: new Date(linha.family_started_at),
        },
        new Date(),
        tetoAbsolutoMs,
      ),
    };
  }

  async emitir(novo: NovoRefresh): Promise<string> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .insert(refreshTokens)
      .values({
        userId: novo.userId,
        familyId: novo.familyId,
        tokenHash: novo.tokenHash,
        familyStartedAt: novo.familyStartedAt,
        expiresAt: novo.expiresAt,
        issuedIp: novo.ip ?? null,
        issuedUserAgent: novo.userAgent ?? null,
      })
      .returning({ id: refreshTokens.id });
    return linha.id;
  }

  async marcarRotacionado(id: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db.execute(sql`
      update refresh_tokens set rotated_at = now() where id = ${id}
    `);
  }

  revogarFamilia(familyId: string, motivo: MotivoDeRevogacao): Promise<number> {
    return this.revogar(sql`family_id = ${familyId}`, motivo);
  }

  revogarTodasDoUsuario(
    userId: string,
    motivo: MotivoDeRevogacao,
  ): Promise<number> {
    return this.revogar(sql`user_id = ${userId}`, motivo);
  }

  /**
   * Revogação em massa com ordem de trava determinística.
   *
   * O `order by id` num sub-select `for update`, em vez de um
   * `update ... where family_id = $1` direto, não é preciosismo: duas
   * detecções de reuso concorrentes na MESMA família travariam as linhas em
   * ordens diferentes e daria deadlock. Com a ordem fixa, uma espera pela
   * outra e as duas terminam.
   */
  private async revogar(
    condicao: ReturnType<typeof sql>,
    motivo: MotivoDeRevogacao,
  ): Promise<number> {
    const db = currentDb(this.rootDb);
    const resultado = await db.execute<{ id: string }>(sql`
      with alvos as (
        select id from refresh_tokens
         where ${condicao}
           and revoked_at is null
         order by id
           for update
      )
      update refresh_tokens t
         set revoked_at = now(),
             revoked_reason = ${motivo}
        from alvos
       where t.id = alvos.id
      returning t.id
    `);
    return (resultado as unknown as { rows?: unknown[] }).rows?.length ?? 0;
  }
}
