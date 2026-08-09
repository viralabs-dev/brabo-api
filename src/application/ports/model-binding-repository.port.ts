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

  /**
   * Apaga o binding de um escopo — `false` quando não havia nenhum.
   *
   * É como se VOLTA A HERDAR (ADR 0064). Gravar no agente o modelo que a área
   * decidiu pareceria o mesmo na tela e não é: viraria cópia, e a próxima
   * mudança da área deixaria esse agente para trás em silêncio. Herança é a
   * AUSÊNCIA de decisão, e desfazer uma decisão é removê-la.
   */
  abstract remove(scope: ModelBindingScope, scopeId: string): Promise<boolean>;
}
