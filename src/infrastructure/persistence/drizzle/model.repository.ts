import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  ModelRepository,
  type ModelInput,
} from '../../../application/ports/model-repository.port';
import type { Model } from '../../../domain/llm/model.entity';
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

  async findById(id: string): Promise<Model | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db.select().from(models).where(eq(models.id, id));
    return row ?? null;
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
          isActive: input.isActive ?? true,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }
}
