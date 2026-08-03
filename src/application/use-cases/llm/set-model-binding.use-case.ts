import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ModelRepository } from '../../ports/model-repository.port';
import { WorkspaceModelRepository } from '../../ports/workspace-model-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import {
  assertModelFitsBindingScope,
  assertModelIsBindable,
} from '../../../domain/llm/model-capabilities';

@Injectable()
export class SetModelBindingUseCase {
  constructor(
    private readonly bindings: ModelBindingRepository,
    private readonly models: ModelRepository,
    private readonly workspaceModels: WorkspaceModelRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async execute(
    scope: ModelBindingScope,
    scopeId: string,
    modelId: string,
    createdBy: string,
  ) {
    const model = await this.models.findById(modelId);
    if (!model) throw new NotFoundException('Modelo não encontrado');

    // Fase 9a (RN-040): um agente sem tool calling nativo falharia só lá na
    // frente, no ToolLoop, como "o modelo parou" — a lição do ADR 0020 é não
    // deixar a origem da falha para descobrir por eliminação.
    assertModelFitsBindingScope(model, scope);

    // Fase 9c (RN-043): binding NOVO só para modelo que o owner ativou e que o
    // sync ainda enxerga no provider. Os bindings antigos ficam de pé — quem
    // lida com eles é a cascata do `resolveBinding`, que pula o indisponível.
    const workspaceId = await this.workspaceDoEscopo(scope, scopeId);
    assertModelIsBindable(
      model,
      workspaceId === null
        ? null
        : await this.workspaceModels.isActive(workspaceId, modelId),
    );

    return this.bindings.upsert({ scope, scopeId, modelId, createdBy });
  }

  /**
   * De qual workspace é esta decisão — e `null` quando não dá para saber.
   *
   * Só dois dos quatro escopos têm âncora: `workspace` É o workspace, e
   * `project` chega nele pelo projeto. `agent` guarda um SLUG global (o
   * `:projectId` da rota é explicitamente ignorado hoje, ver
   * `model-bindings.controller.ts`) e `session` não passa por aqui com projeto
   * na mão. Para esses dois a curadoria não é verificável, e devolver `null`
   * diz isso em vez de chutar um workspace.
   */
  private async workspaceDoEscopo(
    scope: ModelBindingScope,
    scopeId: string,
  ): Promise<string | null> {
    if (scope === 'workspace') return scopeId;
    if (scope === 'project') {
      const project = await this.projects.findById(scopeId);
      if (!project) throw new NotFoundException('Projeto não encontrado');
      return project.workspaceId;
    }
    return null;
  }
}
