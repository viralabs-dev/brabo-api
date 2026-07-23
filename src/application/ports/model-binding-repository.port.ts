import type { ModelBinding } from '../../domain/llm/model-binding.entity';
import type { ModelBindingScope } from '../../domain/llm/model-binding-scope';
import type { ScopedBinding } from '../../domain/llm/binding-resolver';

export abstract class ModelBindingRepository {
  /** Um binding por (scope, scopeId) dentre os pares informados. */
  abstract findCandidates(
    scopeIds: Partial<Record<ModelBindingScope, string>>,
  ): Promise<ScopedBinding[]>;

  abstract findOne(
    scope: ModelBindingScope,
    scopeId: string,
  ): Promise<ModelBinding | null>;

  abstract upsert(input: {
    scope: ModelBindingScope;
    scopeId: string;
    modelId: string;
    createdBy: string;
  }): Promise<ModelBinding>;
}
