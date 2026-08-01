import { Injectable } from '@nestjs/common';
import type { ModelCategory } from '@brabo/shared';
import { ModelRepository } from '../../ports/model-repository.port';
import { categoryForProvider } from '../../../domain/llm/model-category';
import type { Model } from '../../../domain/llm/model.entity';
import type { ModelsByCategory } from './list-models.use-case';

/**
 * O catálogo INTEIRO — inclusive o que o owner desativou e o que sumiu do
 * provider (Fase 9c).
 *
 * `ListModelsUseCase` continua sendo o que alimenta o seletor de modelos e
 * segue mostrando só o ativo. Esta é a tela de curadoria: sem enxergar o
 * inativo não há como ativar o que o sync acabou de descobrir, que é
 * exatamente o estado em que todo modelo descoberto nasce (RN-043).
 */
@Injectable()
export class ListModelCatalogUseCase {
  constructor(private readonly models: ModelRepository) {}

  async execute(): Promise<ModelsByCategory> {
    const all = await this.models.listAll();
    const grouped: ModelsByCategory = { local: {}, cloud: {} };

    for (const model of all) {
      const category: ModelCategory = categoryForProvider(model.provider);
      grouped[category][model.provider] ??= [];
      grouped[category][model.provider].push(model satisfies Model);
    }

    return grouped;
  }
}
