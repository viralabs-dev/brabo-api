import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  MirrorStateRepository,
  type RecordMirrorFailureInput,
  type RecordMirrorSuccessInput,
} from '../../../application/ports/mirror-state-repository.port';
import type { ProjectMirrorState } from '../../../domain/iam/mirror-state';
import { projectMirrorStates } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

type Row = typeof projectMirrorStates.$inferSelect;

function toDomain(row: Row): ProjectMirrorState {
  return {
    projectId: row.projectId,
    lastSyncedAt: row.lastSyncedAt,
    filesCopied: row.filesCopied,
    filesSkipped: row.filesSkipped,
    filesRefused: row.filesRefused,
    destination: row.destination,
    lastErrorAt: row.lastErrorAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

/**
 * `onConflictDoUpdate` em `project_id` nos DOIS caminhos de escrita — é o que
 * torna a primeira rodada e a milésima o mesmo código.
 *
 * O que cada `set` NÃO menciona é o ponto: a escrita de sucesso não toca
 * `last_error`/`last_error_at`, e a de falha não toca nenhuma das colunas de
 * sucesso. Drizzle omite a chave ausente do `UPDATE`, então "não mencionar" é
 * literalmente "não escrever" — e é assim que os dois lados convivem sem que
 * um apague o outro (RN-517).
 */
@Injectable()
export class DrizzleMirrorStateRepository implements MirrorStateRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findByProject(projectId: string): Promise<ProjectMirrorState | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(projectMirrorStates)
      .where(eq(projectMirrorStates.projectId, projectId));
    return row ? toDomain(row) : null;
  }

  async recordSuccess(
    input: RecordMirrorSuccessInput,
  ): Promise<ProjectMirrorState> {
    const db = currentDb(this.rootDb);
    const valores = {
      lastSyncedAt: input.syncedAt,
      filesCopied: input.filesCopied,
      filesSkipped: input.filesSkipped,
      filesRefused: input.filesRefused,
      destination: input.destination,
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(projectMirrorStates)
      .values({ projectId: input.projectId, ...valores })
      .onConflictDoUpdate({
        target: projectMirrorStates.projectId,
        set: valores,
      })
      .returning();
    return toDomain(row);
  }

  async recordFailure(
    input: RecordMirrorFailureInput,
  ): Promise<ProjectMirrorState> {
    const db = currentDb(this.rootDb);
    // `destination` só é sobrescrito quando a rodada sabia qual era — uma
    // falha "destino não concedido" não deve apagar o destino da última
    // cópia que funcionou.
    const valores = {
      lastErrorAt: input.failedAt,
      lastError: input.error,
      ...(input.destination !== null ? { destination: input.destination } : {}),
      updatedAt: new Date(),
    };
    const [row] = await db
      .insert(projectMirrorStates)
      .values({ projectId: input.projectId, ...valores })
      .onConflictDoUpdate({
        target: projectMirrorStates.projectId,
        set: valores,
      })
      .returning();
    return toDomain(row);
  }
}
