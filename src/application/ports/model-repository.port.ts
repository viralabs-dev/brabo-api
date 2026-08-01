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
  isActive?: boolean;
  availability?: ModelAvailability;
  lastSeenAt?: Date | null;
}

export abstract class ModelRepository {
  /** Só os que o owner ativou — é o que o seletor mostra. */
  abstract listActive(): Promise<Model[]>;
  /**
   * TUDO, inclusive inativo e indisponível (Fase 9c): a tela de curadoria
   * precisa ver o que o sync descobriu para o owner poder ativar.
   */
  abstract listAll(): Promise<Model[]>;
  abstract findById(id: string): Promise<Model | null>;
  abstract listByProvider(provider: LLMProviderName): Promise<Model[]>;
  abstract upsertByProviderAndName(input: ModelInput): Promise<Model>;
  /** Curadoria do owner — não mexe em `availability`. */
  abstract setActive(ids: string[], isActive: boolean): Promise<number>;
  /** Realidade remota vinda do sync — não mexe em `is_active`. */
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
