import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';

/**
 * Ações PENDENTES do projeto inteiro, em qualquer sessão (Onda 2 do
 * programa de abas agrupadas — aba PRs).
 *
 * Irmão de `ListProposedActionsUseCase` (escopado por SESSÃO): esta consulta
 * é o que permite a aba PRs achar a `proposed_action` correspondente a um PR
 * (ex.: um `git_merge` proposto pelo botão "Merge") sem saber de antemão
 * qual sessão a propôs — o bug de raiz que escondia revisão de sessão antiga
 * em `ProjectApprovalsTab.tsx`.
 */
@Injectable()
export class ListProjectPendingActionsUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly proposedActions: ProposedActionRepository,
  ) {}

  async execute(projectId: string, actionType?: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return this.proposedActions.findPendingByProject(projectId, actionType);
  }
}
