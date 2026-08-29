import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  RunnerDeviceKeyRepository,
  type ChaveDeDispositivoResumo,
  type ChavePublicaAtiva,
  type NovaChaveDeDispositivo,
} from '../../../application/ports/runner-device-key-repository.port';
import { runnerDeviceKeys } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

function paraResumo(
  linha: typeof runnerDeviceKeys.$inferSelect,
): ChaveDeDispositivoResumo {
  return {
    id: linha.id,
    name: linha.name,
    projectId: linha.projectId,
    createdAt: linha.createdAt,
    revokedAt: linha.revokedAt,
    lastUsedAt: linha.lastUsedAt,
  };
}

@Injectable()
export class DrizzleRunnerDeviceKeyRepository extends RunnerDeviceKeyRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {
    super();
  }

  async registrar(
    nova: NovaChaveDeDispositivo,
  ): Promise<ChaveDeDispositivoResumo> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .insert(runnerDeviceKeys)
      .values({
        userId: nova.userId,
        projectId: nova.projectId,
        name: nova.name,
        publicKeyJwk: nova.publicKeyJwk,
      })
      .returning();
    return paraResumo(linha);
  }

  async buscarChavePublicaAtiva(
    deviceKeyId: string,
  ): Promise<ChavePublicaAtiva | null> {
    const db = currentDb(this.rootDb);
    const [linha] = await db
      .select({
        id: runnerDeviceKeys.id,
        userId: runnerDeviceKeys.userId,
        projectId: runnerDeviceKeys.projectId,
        publicKeyJwk: runnerDeviceKeys.publicKeyJwk,
      })
      .from(runnerDeviceKeys)
      .where(
        and(
          eq(runnerDeviceKeys.id, deviceKeyId),
          isNull(runnerDeviceKeys.revokedAt),
        ),
      );
    return linha ?? null;
  }

  async revogar(
    id: string,
    userId: string,
    motivo: string,
  ): Promise<ChaveDeDispositivoResumo | null> {
    const db = currentDb(this.rootDb);

    const [revogada] = await db
      .update(runnerDeviceKeys)
      .set({ revokedAt: new Date(), revokedReason: motivo })
      .where(
        and(
          eq(runnerDeviceKeys.id, id),
          eq(runnerDeviceKeys.userId, userId),
          sql`${runnerDeviceKeys.revokedAt} is null`,
        ),
      )
      .returning();
    if (revogada) return paraResumo(revogada);

    // Zero linhas: ou já estava revogada (devolve a linha, idempotente), ou
    // não existe/não é do usuário (devolve null — mesma resposta pros dois,
    // não vaza existência de chave alheia).
    const [existente] = await db
      .select()
      .from(runnerDeviceKeys)
      .where(
        and(eq(runnerDeviceKeys.id, id), eq(runnerDeviceKeys.userId, userId)),
      );
    return existente ? paraResumo(existente) : null;
  }

  async tocarUso(id: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .update(runnerDeviceKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(runnerDeviceKeys.id, id));
  }
}
