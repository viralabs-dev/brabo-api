import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { ModelBindingRepository } from '../../../application/ports/model-binding-repository.port';
import type { ModelBinding } from '../../../domain/llm/model-binding.entity';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import type { ScopedBinding } from '../../../domain/llm/binding-resolver';
import { modelBindings } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleModelBindingRepository implements ModelBindingRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findCandidates(
    scopeIds: Partial<Record<ModelBindingScope, string>>,
  ): Promise<ScopedBinding[]> {
    const pairs = Object.entries(scopeIds).filter(
      (entry): entry is [ModelBindingScope, string] => Boolean(entry[1]),
    );
    if (pairs.length === 0) return [];

    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ scope: modelBindings.scope, modelId: modelBindings.modelId })
      .from(modelBindings)
      .where(
        or(
          ...pairs.map(([scope, scopeId]) =>
            and(
              eq(modelBindings.scope, scope),
              eq(modelBindings.scopeId, scopeId),
            ),
          ),
        ),
      );
    return rows;
  }

  async findOne(
    scope: ModelBindingScope,
    scopeId: string,
  ): Promise<ModelBinding | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(modelBindings)
      .where(
        and(eq(modelBindings.scope, scope), eq(modelBindings.scopeId, scopeId)),
      );
    return row ?? null;
  }

  async upsert(input: {
    scope: ModelBindingScope;
    scopeId: string;
    modelId: string;
    createdBy: string;
  }): Promise<ModelBinding> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(modelBindings)
      .values(input)
      .onConflictDoUpdate({
        target: [modelBindings.scope, modelBindings.scopeId],
        set: { modelId: input.modelId, updatedAt: new Date() },
      })
      .returning();
    return row;
  }
}
