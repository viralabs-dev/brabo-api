import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';
import { ModelBindingRepository } from '../../../application/ports/model-binding-repository.port';
import type { ModelBinding } from '../../../domain/llm/model-binding.entity';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import type { ScopedBinding } from '../../../domain/llm/binding-resolver';
import { modelBindings, models } from '../../../db/schema';
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
    // Join com `models` (Fase 9c): o resolver precisa saber se o modelo do
    // binding ainda existe no catálogo remoto e se ele faz tool calling — sem
    // isso a cascata não tem como pular um nível quebrado.
    const rows = await db
      .select({
        scope: modelBindings.scope,
        modelId: modelBindings.modelId,
        availability: models.availability,
        supportsToolCalling: models.supportsToolCalling,
      })
      .from(modelBindings)
      .innerJoin(models, eq(models.id, modelBindings.modelId))
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

  async remove(scope: ModelBindingScope, scopeId: string): Promise<boolean> {
    const db = currentDb(this.rootDb);
    const apagados = await db
      .delete(modelBindings)
      .where(
        and(eq(modelBindings.scope, scope), eq(modelBindings.scopeId, scopeId)),
      )
      .returning({ id: modelBindings.id });
    return apagados.length > 0;
  }
}
