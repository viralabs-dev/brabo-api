import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  ModelPriceChangeRepository,
  type RecordPriceChangeInput,
} from '../../../application/ports/model-price-change-repository.port';
import type { ModelPriceChange } from '../../../domain/llm/model-price-change.entity';
import { modelPriceChanges } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleModelPriceChangeRepository implements ModelPriceChangeRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async record(input: RecordPriceChangeInput): Promise<ModelPriceChange> {
    const db = currentDb(this.rootDb);
    const [row] = await db.insert(modelPriceChanges).values(input).returning();
    return row;
  }

  async listByModel(modelId: string): Promise<ModelPriceChange[]> {
    const db = currentDb(this.rootDb);
    return db
      .select()
      .from(modelPriceChanges)
      .where(eq(modelPriceChanges.modelId, modelId))
      .orderBy(desc(modelPriceChanges.createdAt));
  }
}
