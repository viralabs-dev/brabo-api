import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  TokenUsageRepository,
  type AgentTokenUsage,
  type RecordTokenUsageInput,
  type WorkspaceTokenUsageSummary,
} from '../../../application/ports/token-usage-repository.port';
import type { TokenUsage } from '../../../domain/llm/token-usage.entity';
import { projects, sessions, tokenUsage } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleTokenUsageRepository implements TokenUsageRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async record(input: RecordTokenUsageInput): Promise<TokenUsage> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(tokenUsage)
      .values({
        sessionId: input.sessionId,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        provider: input.provider,
        modelId: input.modelId,
        modelName: input.modelName,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        estimated: input.estimated,
        costMicros: input.costMicros,
        latencyMs: input.latencyMs,
        bindingOrigin: input.bindingOrigin,
      })
      .returning();

    return {
      id: row.id,
      sessionId: row.sessionId,
      actor: { kind: row.actorKind, id: row.actorId },
      provider: row.provider,
      modelId: row.modelId,
      modelName: row.modelName,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      estimated: row.estimated,
      costMicros: row.costMicros,
      latencyMs: row.latencyMs,
      bindingOrigin: row.bindingOrigin,
      createdAt: row.createdAt,
    };
  }

  async sumBySessionAndActorIds(
    sessionId: string,
    actorIds: string[],
  ): Promise<number> {
    if (actorIds.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const [result] = await db
      .select({
        total: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
      })
      .from(tokenUsage)
      .where(
        and(
          eq(tokenUsage.sessionId, sessionId),
          inArray(tokenUsage.actorId, actorIds),
        ),
      );
    return Number(result?.total ?? 0);
  }

  async sumBySessionGroupedByActor(
    sessionId: string,
  ): Promise<AgentTokenUsage[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        actorId: tokenUsage.actorId,
        costMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
        inputTokens: sql<string>`coalesce(sum(${tokenUsage.inputTokens}), 0)`,
        outputTokens: sql<string>`coalesce(sum(${tokenUsage.outputTokens}), 0)`,
      })
      .from(tokenUsage)
      .where(eq(tokenUsage.sessionId, sessionId))
      .groupBy(tokenUsage.actorId);

    return rows.map((row) => ({
      actorId: row.actorId,
      costMicros: Number(row.costMicros),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
  }

  async summarizeForWorkspaceThisMonth(
    workspaceId: string,
  ): Promise<WorkspaceTokenUsageSummary> {
    const db = currentDb(this.rootDb);
    const [result] = await db
      .select({
        agentCount: sql<string>`count(distinct ${tokenUsage.actorId})`,
        spentMicros: sql<string>`coalesce(sum(${tokenUsage.costMicros}), 0)`,
      })
      .from(tokenUsage)
      .innerJoin(sessions, eq(sessions.id, tokenUsage.sessionId))
      .innerJoin(projects, eq(projects.id, sessions.projectId))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(tokenUsage.actorKind, 'agent'),
          gte(tokenUsage.createdAt, sql`date_trunc('month', now())`),
        ),
      );

    return {
      agentCount: Number(result?.agentCount ?? 0),
      spentMicros: Number(result?.spentMicros ?? 0),
    };
  }
}
