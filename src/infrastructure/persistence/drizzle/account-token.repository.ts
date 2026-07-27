import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import {
  AccountTokenRepository,
  type PropositoDeToken,
  type TokenConsumido,
} from '../../../application/ports/account-token-repository.port';
import { accountTokens } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type LinhaConsumida = {
  id: string;
  user_id: string;
  created_at: Date;
};

@Injectable()
export class DrizzleAccountTokenRepository extends AccountTokenRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async emitir(entrada: {
    userId: string;
    purpose: PropositoDeToken;
    tokenHash: string;
    expiresAt: Date;
    ip?: string | null;
  }): Promise<void> {
    const db = currentDb(this.rootDb);

    // Supersede ANTES de inserir. Sem isso, cinco cliques em "esqueci minha
    // senha" deixam cinco links de takeover válidos em cinco e-mails.
    await this.invalidarVivos(entrada.userId, [entrada.purpose], 'superseded');

    await db.insert(accountTokens).values({
      userId: entrada.userId,
      purpose: entrada.purpose,
      tokenHash: entrada.tokenHash,
      expiresAt: entrada.expiresAt,
      requestedIp: entrada.ip ?? null,
    });
  }

  /**
   * Consumo atômico: o UPDATE condicional É a guarda.
   *
   * Zero linhas devolvidas cobre inexistente, propósito errado, já consumido,
   * invalidado e expirado — todos com a mesma resposta ao cliente. O chamador
   * pode reconsultar para o LOG, mas nunca para a resposta: distinguir "já
   * usado" de "expirado" contaria a um ladrão de token se a vítima chegou
   * primeiro.
   *
   * Prova de concorrência: os dois statements chegam à mesma linha pelo índice
   * único de `token_hash`. O segundo bloqueia; quando o primeiro commita, o
   * Postgres reavalia o qualificador contra a tupla nova, `consumed_at is
   * null` falha, e o segundo atualiza zero linhas.
   */
  async consumir(entrada: {
    tokenHash: string;
    purpose: PropositoDeToken;
    ip?: string | null;
  }): Promise<TokenConsumido | null> {
    const db = currentDb(this.rootDb);

    const resultado = await db.execute<LinhaConsumida>(sql`
      update account_tokens
         set consumed_at = now(),
             consumed_ip = ${entrada.ip ?? null}
       where token_hash     = ${entrada.tokenHash}
         and purpose        = ${entrada.purpose}
         and consumed_at    is null
         and invalidated_at is null
         and expires_at     > now()
      returning id, user_id, created_at
    `);

    const linha = (resultado as unknown as { rows?: LinhaConsumida[] })
      .rows?.[0];
    if (!linha) return null;

    return {
      id: linha.id,
      userId: linha.user_id,
      createdAt: new Date(linha.created_at),
    };
  }

  async existeVivo(
    userId: string,
    purpose: PropositoDeToken,
  ): Promise<boolean> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .select({ id: accountTokens.id })
      .from(accountTokens)
      .where(
        and(
          eq(accountTokens.userId, userId),
          eq(accountTokens.purpose, purpose),
          isNull(accountTokens.consumedAt),
          isNull(accountTokens.invalidatedAt),
          gt(accountTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return linhas.length > 0;
  }

  async invalidarVivos(
    userId: string,
    purposes: PropositoDeToken[],
    motivo: string,
  ): Promise<number> {
    const db = currentDb(this.rootDb);
    const linhas = await db
      .update(accountTokens)
      .set({ invalidatedAt: new Date(), invalidatedReason: motivo })
      .where(
        and(
          eq(accountTokens.userId, userId),
          inArray(accountTokens.purpose, purposes),
          isNull(accountTokens.consumedAt),
          isNull(accountTokens.invalidatedAt),
        ),
      )
      .returning({ id: accountTokens.id });
    return linhas.length;
  }
}
