import type { LLMProviderName } from '@brabo/shared';

export interface Model {
  id: string;
  provider: LLMProviderName;
  name: string;
  displayName: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  contextWindow: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
