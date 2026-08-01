import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { LLMProviderName } from '@brabo/shared';
import {
  ModelRepository,
  type ModelInput,
} from '../../../application/ports/model-repository.port';
import type {
  Model,
  ModelAvailability,
} from '../../../domain/llm/model.entity';
import { models } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleModelRepository implements ModelRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listActive(): Promise<Model[]> {
    const db = currentDb(this.rootDb);
    return db.select().from(models).where(eq(models.isActive, true));
  }

  async listAll(): Promise<Model[]> {
    const db = currentDb(this.rootDb);
    return db.select().from(models);
  }

  async findById(id: string): Promise<Model | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db.select().from(models).where(eq(models.id, id));
    return row ?? null;
  }

  async listByProvider(provider: LLMProviderName): Promise<Model[]> {
    const db = currentDb(this.rootDb);
    return db.select().from(models).where(eq(models.provider, provider));
  }

  async upsertByProviderAndName(input: ModelInput): Promise<Model> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(models)
      .values(input)
      .onConflictDoUpdate({
        target: [models.provider, models.name],
        set: {
          displayName: input.displayName,
          inputPricePerMillionMicros: input.inputPricePerMillionMicros,
          outputPricePerMillionMicros: input.outputPricePerMillionMicros,
          contextWindow: input.contextWindow ?? null,
          supportsToolCalling: input.supportsToolCalling ?? false,
          supportsStreaming: input.supportsStreaming ?? true,
          supportsVision: input.supportsVision ?? false,
          manualPricing: input.manualPricing ?? true,
          // `isActive` NÃO entra no update: é curadoria do owner, e o sync
          // reencontrando um modelo não pode religar o que alguém desligou
          // de propósito (Fase 9c, RN-043).
          availability: input.availability ?? 'available',
          lastSeenAt: input.lastSeenAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async setActive(ids: string[], isActive: boolean): Promise<number> {
    if (ids.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const rows = await db
      .update(models)
      .set({ isActive, updatedAt: new Date() })
      .where(inArray(models.id, ids))
      .returning({ id: models.id });
    return rows.length;
  }

  async setAvailability(
    ids: string[],
    availability: ModelAvailability,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const db = currentDb(this.rootDb);
    const rows = await db
      .update(models)
      .set({ availability, updatedAt: new Date() })
      .where(inArray(models.id, ids))
      .returning({ id: models.id });
    return rows.length;
  }

  async updatePricing(
    id: string,
    input: {
      inputPricePerMillionMicros: number;
      outputPricePerMillionMicros: number;
    },
  ): Promise<Model> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(models)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(models.id, id))
      .returning();
    return row;
  }
}
