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

  async execute(
    projectId: string,
    actionType?: string,
    status: 'pending' | 'failed' = 'pending',
  ) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    if (status === 'failed') {
      // RN-705: as recusas de execução (ex.: o conflito de merge), para a aba
      // PRs mostrar a última de cada PR. Exige `actionType` (o controller
      // recusa sem ele): sem tipo, a leitura seria o histórico inteiro.
      const todas = await this.proposedActions.listByProjectAndType(
        projectId,
        actionType ?? '',
      );
      return todas.filter((a) => a.status === 'failed');
    }
    return this.proposedActions.findPendingByProject(projectId, actionType);
  }
}
