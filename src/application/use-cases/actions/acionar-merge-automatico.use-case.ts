import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProposeActionUseCase } from './propose-action.use-case';
import { BRANCH_DE_TRABALHO } from '../../../domain/actions/protected-branches';
import { recusaDeMerge } from '../../../domain/actions/merge-de-pr';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { Traced } from '../../../infrastructure/observability/traced.decorator';

/**
 * O GATILHO do merge automático (RN-1316, AT-902, ADR 0292): o engine chama
 * quando um gate aprova, e TODA a régua mora aqui — o engine só repassa.
 *
 * Confere, nesta ordem, e recusa com 409 de `code` nomeado: chave ligada;
 * tarefa com todos os gates aprovados (`gateStatus: awaiting_user`) e não
 * bloqueada; PR aberta pela tarefa; PR não mergeada nem já proposta (RN-663).
 * Passando, propõe `git_merge` com `origem: 'merge_automatico'` pelo
 * `ProposeActionUseCase` — o ÚNICO que `decide()` deixa auto-aprovar, e só com
 * a chave ligada e destino na branch de trabalho. Conflito não é pré-checado
 * (o contrato do provider não o expõe): o merge falha no provider e a proposta
 * termina `failed` pelo caminho da RN-715, que acorda o dev.
 */
@Injectable()
export class AcionarMergeAutomaticoUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly tasks: TaskRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly proposeAction: ProposeActionUseCase,
  ) {}

  @Traced('application')
  async execute(
    projectId: string,
    taskId: string,
    sessionId: string,
  ): Promise<ProposedAction> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');

    const recusa = (code: string, message: string) =>
      new ConflictException({ code, message });

    if (!project.mergeAutomatico) {
      throw recusa(
        'chave_desligada',
        'O merge automático está desligado neste projeto.',
      );
    }

    const [task] = await this.tasks.findInProjectByIds(projectId, [taskId]);
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    if (
      task.gateStatus !== 'awaiting_user' ||
      task.blocked ||
      task.archivedAt
    ) {
      throw recusa(
        'gate_pendente',
        'A tarefa ainda não tem todos os gates aprovados.',
      );
    }

    const prAction = (
      await this.proposedActions.listByProjectAndType(projectId, 'pr_open')
    )
      .filter(
        (a) => (a.payload as { storyTaskId?: unknown }).storyTaskId === taskId,
      )
      .sort((a, b) => b.seq - a.seq)[0];
    const r = prAction?.executionResult;
    const pullRequestId =
      r && 'kind' in r && r.kind === 'pr_open' ? r.pullRequestId : undefined;
    if (!pullRequestId) {
      throw recusa('sem_pr', 'A tarefa não tem PR aberta.');
    }

    const duplicado = recusaDeMerge(
      pullRequestId,
      await this.proposedActions.listByProjectAndType(projectId, 'git_merge'),
    );
    if (duplicado) throw recusa(duplicado.code, duplicado.message);

    return this.proposeAction.execute(projectId, sessionId, {
      actionType: 'git_merge',
      actor: { kind: 'system', id: 'merge_automatico' },
      payload: {
        pullRequestId,
        targetBranch: BRANCH_DE_TRABALHO,
        storyTaskId: taskId,
      },
      origem: 'merge_automatico',
    });
  }
}
