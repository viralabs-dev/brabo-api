import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  PersonalAccessTokenRepository,
  type NovoPat,
  type PatResumo,
  type PatValidado,
} from '../../../application/ports/personal-access-token-repository.port';
import { personalAccessTokens } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type LinhaValidada = {
  id: string;
  user_id: string;
  project_id: string;
};

function paraResumo(
  linha: typeof personalAccessTokens.$inferSelect,
): PatResumo {
  return {
    id: linha.id,
    name: linha.name,
    projectId: linha.projectId,
    createdAt: linha.createdAt,
    expiresAt: linha.expiresAt,
    revokedAt: linha.revokedAt,
    lastUsedAt: linha.lastUsedAt,
  };
}

@Injectable()
export class DrizzlePersonalAccessTokenRepository extends PersonalAccessTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async emitir(novo: NovoPat): Promise<PatResumo> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .insert(personalAccessTokens)
      .values({
        userId: novo.userId,
        projectId: novo.projectId,
        name: novo.name,
        tokenHash: novo.tokenHash,
        expiresAt: novo.expiresAt,
      })
      .returning();
    return paraResumo(linha);
  }

  /**
   * UMA consulta: o UPDATE condicional É a validação, mesmo padrão de
   * `AccountTokenRepository.consumir`. `last_used_at` é tocado sempre que o
   * WHERE bate — sem throttle no mesmo predicado, que rejeitaria um token
   * válido reapresentado cedo demais.
   */
  async validarEUsar(tokenHash: string): Promise<PatValidado | null> {
    const db = currentDb(this.rootDb);

    const resultado = await db.execute<LinhaValidada>(sql`
      update personal_access_tokens
         set last_used_at = now()
       where token_hash = ${tokenHash}
         and revoked_at is null
         and (expires_at is null or expires_at > now())
      returning id, user_id, project_id
    `);

    const linha = (resultado as unknown as { rows?: LinhaValidada[] })
      .rows?.[0];
    if (!linha) return null;

    return { id: linha.id, userId: linha.user_id, projectId: linha.project_id };
  }

  async listarDoUsuarioNoProjeto(
    userId: string,
    projectId: string,
  ): Promise<PatResumo[]> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .select()
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.userId, userId),
          eq(personalAccessTokens.projectId, projectId),
        ),
      );
    return linhas.map(paraResumo);
  }

  async revogar(
    id: string,
    userId: string,
    motivo: string,
  ): Promise<PatResumo | null> {
    const db = currentDb(this.rootDb);

    const [revogado] = await db
      .update(personalAccessTokens)
      .set({ revokedAt: new Date(), revokedReason: motivo })
      .where(
        and(
          eq(personalAccessTokens.id, id),
          eq(personalAccessTokens.userId, userId),
          sql`${personalAccessTokens.revokedAt} is null`,
        ),
      )
      .returning();
    if (revogado) return paraResumo(revogado);

    // Zero linhas: ou já estava revogado (devolve a linha, idempotente), ou
    // não existe/não é do usuário (devolve null — mesma resposta pros dois,
    // não vaza existência de token alheio).
    const [existente] = await db
      .select()
      .from(personalAccessTokens)
      .where(
        and(
          eq(personalAccessTokens.id, id),
          eq(personalAccessTokens.userId, userId),
        ),
      );
    return existente ? paraResumo(existente) : null;
  }
}
