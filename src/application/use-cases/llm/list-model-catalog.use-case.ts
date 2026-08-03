import { Injectable } from '@nestjs/common';
import type { ModelCategory } from '@brabo/shared';
import { WorkspaceModelRepository } from '../../ports/workspace-model-repository.port';
import { categoryForProvider } from '../../../domain/llm/model-category';
import type { ModelComCuradoria } from '../../../domain/llm/model.entity';

export type CatalogoPorCategoria = Record<
  ModelCategory,
  Record<string, ModelComCuradoria[]>
>;

/**
 * O catálogo INTEIRO daquele workspace — inclusive o que ninguém ligou e o que
 * sumiu do provider (Fase 9c, agora por workspace no ADR 0049).
 *
 * `ListModelsUseCase` continua sendo o que alimenta o seletor e segue
 * mostrando só o ativo. Esta é a tela de curadoria: sem enxergar o inativo não
 * há como ativar o que o sync acabou de descobrir, que é exatamente o estado
 * em que todo modelo descoberto nasce (RN-043).
 *
 * O `isActive` de cada linha é o DAQUELE workspace, não um atributo do modelo:
 * o mesmo modelo pode sair ligado aqui e desligado no workspace vizinho, e é
 * essa a diferença que o ADR 0049 existe para introduzir.
 */
@Injectable()
export class ListModelCatalogUseCase {
  constructor(private readonly workspaceModels: WorkspaceModelRepository) {}

  async execute(workspaceId: string): Promise<CatalogoPorCategoria> {
    const todos = await this.workspaceModels.listAllComCuradoria(workspaceId);
    const grouped: CatalogoPorCategoria = { local: {}, cloud: {} };

    for (const model of todos) {
      const category: ModelCategory = categoryForProvider(model.provider);
      grouped[category][model.provider] ??= [];
      grouped[category][model.provider].push(model);
    }

    return grouped;
  }
}
