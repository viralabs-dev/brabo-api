import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  ChunkRepository,
  type Chunk,
  type ChunkScope,
  type NewChunk,
} from '../../../application/ports/chunk-repository.port';
import { chunks } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleChunkRepository implements ChunkRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewChunk): Promise<Chunk> {
    const [row] = await this.insertMany([input]);
    return row;
  }

  async createMany(inputs: NewChunk[]): Promise<Chunk[]> {
    if (inputs.length === 0) return [];
    return this.insertMany(inputs);
  }

  private async insertMany(inputs: NewChunk[]): Promise<Chunk[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .insert(chunks)
      .values(
        inputs.map((input) => ({
          projectId: input.projectId,
          scope: input.scope,
          sessionId: input.sessionId ?? null,
          sourcePath: input.sourcePath ?? null,
          content: input.content,
          embedding: input.embedding ?? null,
          metadata: input.metadata ?? {},
        })),
      )
      .returning();
    return rows.map(toEntity);
  }

  async findById(id: string): Promise<Chunk | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(chunks)
      .where(eq(chunks.id, id))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async listByProject(projectId: string, scope?: ChunkScope): Promise<Chunk[]> {
    const db = currentDb(this.rootDb);
    const condition = scope
      ? and(eq(chunks.projectId, projectId), eq(chunks.scope, scope))
      : eq(chunks.projectId, projectId);
    const rows = await db.select().from(chunks).where(condition);
    return rows.map(toEntity);
  }
}

function toEntity(row: typeof chunks.$inferSelect): Chunk {
  return {
    id: row.id,
    projectId: row.projectId,
    scope: row.scope,
    sessionId: row.sessionId,
    sourcePath: row.sourcePath,
    content: row.content,
    embedding: row.embedding ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}
