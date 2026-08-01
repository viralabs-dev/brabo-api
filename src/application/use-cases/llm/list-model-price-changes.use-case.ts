import { Injectable } from '@nestjs/common';
import { ModelPriceChangeRepository } from '../../ports/model-price-change-repository.port';
import type { ModelPriceChange } from '../../../domain/llm/model-price-change.entity';

/** A auditoria de preço de um modelo, mais recente primeiro (Fase 9c). */
@Injectable()
export class ListModelPriceChangesUseCase {
  constructor(private readonly priceChanges: ModelPriceChangeRepository) {}

  execute(modelId: string): Promise<ModelPriceChange[]> {
    return this.priceChanges.listByModel(modelId);
  }
}
