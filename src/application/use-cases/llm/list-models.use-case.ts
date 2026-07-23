import { Injectable } from '@nestjs/common';
import type { ModelCategory } from '@brabo/shared';
import { ModelRepository } from '../../ports/model-repository.port';
import { categoryForProvider } from '../../../domain/llm/model-category';
import type { Model } from '../../../domain/llm/model.entity';

export type ModelsByCategory = Record<ModelCategory, Record<string, Model[]>>;

@Injectable()
export class ListModelsUseCase {
  constructor(private readonly models: ModelRepository) {}

  async execute(): Promise<ModelsByCategory> {
    const all = await this.models.listActive();
    const grouped: ModelsByCategory = { local: {}, cloud: {} };

    for (const model of all) {
      const category = categoryForProvider(model.provider);
      grouped[category][model.provider] ??= [];
      grouped[category][model.provider].push(model);
    }

    return grouped;
  }
}
