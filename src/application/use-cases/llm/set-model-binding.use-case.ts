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
import {
  assertScopeIdBemFormado,
  ehEscopoDeProjeto,
  lerChaveDeProjeto,
} from '../../../domain/llm/binding-scope-id';

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
    // Antes de tudo: `scope_id` de `agent`/`area` sem projeto (ADR 0064) é
    // binding que a cascata nunca mais encontraria — recusa em vez de gravar
    // um fantasma.
    assertScopeIdBemFormado(scope, scopeId);

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
   * `workspace` É o workspace; `project`, `agent` e `area` chegam nele pelo
   * projeto. Os dois últimos passaram a chegar no ADR 0064, quando o `scope_id`
   * deles virou `<projectId>:<chave>`: antes o binding de agente guardava um
   * SLUG global e a curadoria da RN-043 simplesmente não era verificável ali —
   * dava para vincular um agente a modelo que o owner tinha desligado. Sobra
   * `session`, que não passa por aqui com projeto na mão; devolver `null` diz
   * isso em vez de chutar um workspace.
   */
  private async workspaceDoEscopo(
    scope: ModelBindingScope,
    scopeId: string,
  ): Promise<string | null> {
    if (scope === 'workspace') return scopeId;

    const projectId = ehEscopoDeProjeto(scope)
      ? lerChaveDeProjeto(scopeId)?.projectId
      : scope === 'project'
        ? scopeId
        : undefined;
    if (!projectId) return null;

    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project.workspaceId;
  }
}
