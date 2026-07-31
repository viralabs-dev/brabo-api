import type { LLMProviderName } from '@brabo/shared';
import type { Model } from '../../domain/llm/model.entity';

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
}

export abstract class ModelRepository {
  abstract listActive(): Promise<Model[]>;
  abstract findById(id: string): Promise<Model | null>;
  abstract upsertByProviderAndName(input: ModelInput): Promise<Model>;
}
