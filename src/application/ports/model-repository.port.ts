import type { LLMProviderName } from '@brabo/shared';
import type { Model, ModelAvailability } from '../../domain/llm/model.entity';

export interface ModelInput {
  provider: LLMProviderName;
  name: string;
  displayName: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  contextWindow?: number | null;
  supportsToolCalling?: boolean;
  supportsStreaming?: boolean;
  supportsVision?: boolean;
  manualPricing?: boolean;
  availability?: ModelAvailability;
  lastSeenAt?: Date | null;
}

/**
 * O catálogo GLOBAL: o que o provider oferece.
 *
 * A curadoria não está aqui — ela é por workspace e vive em
 * `WorkspaceModelRepository` (ADR 0049). Este repositório não sabe responder
 * "aparece no seletor?", e é de propósito: a pergunta não tem resposta sem um
 * workspace junto.
 */
export abstract class ModelRepository {
  /**
   * TUDO, inclusive indisponível (Fase 9c): a tela de curadoria precisa ver o
   * que o sync descobriu para o owner poder ativar.
   */
  abstract listAll(): Promise<Model[]>;
  abstract findById(id: string): Promise<Model | null>;
  abstract listByProvider(provider: LLMProviderName): Promise<Model[]>;
  abstract upsertByProviderAndName(input: ModelInput): Promise<Model>;
  /** Realidade remota vinda do sync. */
  abstract setAvailability(
    ids: string[],
    availability: ModelAvailability,
  ): Promise<number>;
  abstract updatePricing(
    id: string,
    input: {
      inputPricePerMillionMicros: number;
      outputPricePerMillionMicros: number;
    },
  ): Promise<Model>;
}
