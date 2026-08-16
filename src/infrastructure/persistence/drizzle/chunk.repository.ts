import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  sql,
} from 'drizzle-orm';
import {
  ChunkRepository,
  type Chunk,
  type ChunkScope,
  type ChunkSearchCandidate,
  type ChunkSearchOptions,
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

  async deleteByScope(
    projectId: string,
    scope: Exclude<ChunkScope, 'session'>,
  ): Promise<number> {
    const db = currentDb(this.rootDb);
    const apagados = await db
      .delete(chunks)
      .where(and(eq(chunks.projectId, projectId), eq(chunks.scope, scope)))
      .returning({ id: chunks.id });
    return apagados.length;
  }

  async deleteBySession(sessionId: string): Promise<number> {
    const db = currentDb(this.rootDb);
    const apagados = await db
      .delete(chunks)
      .where(eq(chunks.sessionId, sessionId))
      .returning({ id: chunks.id });
    return apagados.length;
  }

  async searchByVector(
    projectId: string,
    queryVector: number[],
    opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]> {
    const db = currentDb(this.rootDb);
    const distancia = cosineDistance(chunks.embedding, queryVector);
    const condicoes = [eq(chunks.projectId, projectId), isNotNull(chunks.embedding)];
    if (opts.scope?.length) condicoes.push(inArray(chunks.scope, opts.scope));

    const linhas = await db
      .select({ chunk: chunks, distancia: sql<number>`${distancia}` })
      .from(chunks)
      .where(and(...condicoes))
      .orderBy(asc(distancia))
      .limit(opts.limit);

    // similaridade = 1 - distância de cosseno. Clampada em [0, 1]: a
    // distância pode passar de 1 para vetores pouco relacionados, o que
    // daria similaridade negativa — sem sentido como "score de relevância".
    return linhas.map((linha) => ({
      chunk: toEntity(linha.chunk),
      score: Math.min(1, Math.max(0, 1 - Number(linha.distancia))),
    }));
  }

  async searchByLexicalQuery(
    projectId: string,
    query: string,
    opts: ChunkSearchOptions,
  ): Promise<ChunkSearchCandidate[]> {
    const db = currentDb(this.rootDb);
    const consulta = sql`plainto_tsquery('portuguese', ${query})`;
    // Normalização 32 = rank / (rank + 1): mantém o resultado sempre em
    // [0, 1), na mesma família de escala que a similaridade de cosseno —
    // sem isso, `ts_rank` cru é ilimitado e a fusão de pesos (ADR 0080)
    // não teria régua nenhuma para comparar as duas metades.
    const rank = sql<number>`ts_rank(${chunks.searchVector}, ${consulta}, 32)`;
    const condicoes = [
      eq(chunks.projectId, projectId),
      sql`${chunks.searchVector} @@ ${consulta}`,
    ];
    if (opts.scope?.length) condicoes.push(inArray(chunks.scope, opts.scope));

    const linhas = await db
      .select({ chunk: chunks, rank })
      .from(chunks)
      .where(and(...condicoes))
      .orderBy(desc(rank))
      .limit(opts.limit);

    return linhas.map((linha) => ({
      chunk: toEntity(linha.chunk),
      score: Number(linha.rank),
    }));
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
