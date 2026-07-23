import { Inject, Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type RecordTokenUsageInput,
} from '../../../application/ports/token-usage-repository.port';
import type { TokenUsage } from '../../../domain/llm/token-usage.entity';
import { tokenUsage } from '../../../db/schema';
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
}
