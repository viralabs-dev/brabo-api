import { Injectable, NotFoundException } from '@nestjs/common';
import type { ModelCategory } from '@brabo/shared';
import { WorkspaceModelRepository } from '../../ports/workspace-model-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { categoryForProvider } from '../../../domain/llm/model-category';
import type { Model } from '../../../domain/llm/model.entity';

export type ModelsByCategory = Record<ModelCategory, Record<string, Model[]>>;

/**
 * O que o seletor mostra, no workspace DAQUELE projeto (ADR 0049).
 *
 * A pergunta chega por projeto, e não por workspace, porque é assim que ela
 * nasce: as três telas que consomem esta lista (visão geral, ajustes e a
 * sessão) estão todas dentro de um projeto, e nenhuma tinha um workspace na
 * mão. Traduzir aqui evita espalhar a conversão pela UI — e o `RolesGuard` já
 * sabe tirar papel de um `:projectId`.
 */
@Injectable()
export class ListModelsUseCase {
  constructor(
    private readonly workspaceModels: WorkspaceModelRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(projectId: string): Promise<ModelsByCategory> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const ativos = await this.workspaceModels.listActive(project.workspaceId);
    const grouped: ModelsByCategory = { local: {}, cloud: {} };

    for (const model of ativos) {
      const category = categoryForProvider(model.provider);
      grouped[category][model.provider] ??= [];
      grouped[category][model.provider].push(model);
    }

    return grouped;
  }
}
