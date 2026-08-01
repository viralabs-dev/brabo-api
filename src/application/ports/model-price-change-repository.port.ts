import type {
  ModelPriceChange,
  PriceChangeSource,
} from '../../domain/llm/model-price-change.entity';

export interface RecordPriceChangeInput {
  modelId: string;
  inputBeforeMicros: number;
  inputAfterMicros: number;
  outputBeforeMicros: number;
  outputAfterMicros: number;
  source: PriceChangeSource;
  changedBy: string | null;
}

/** Append-only: não existe `update` nem `delete` aqui, e é de propósito. */
export abstract class ModelPriceChangeRepository {
  abstract record(input: RecordPriceChangeInput): Promise<ModelPriceChange>;
  /** Mais recente primeiro — é a ordem em que a auditoria é lida. */
  abstract listByModel(modelId: string): Promise<ModelPriceChange[]>;
}
