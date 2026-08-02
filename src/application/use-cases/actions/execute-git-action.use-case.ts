import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { GitActionExecutionResult } from '../../../domain/git/git-action-execution-result';

// Coerção segura de campos `unknown` (payload/resultado do engine) para
// string — evita o `[object Object]` que o String(unknown) permitiria.
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Executor único das ações git dos dev agents (Fase 4a), roteado por
 * `ApproveActionUseCase` (aprovação manual) e `ProposeActionUseCase`
 * (auto_approved). `git_commit`/`git_push` rodam NO ENGINE (git local no
 * worktree do agente, via ApiToEngineClient — espelha o terminal); `pr_open`/
 * `git_merge` rodam aqui via o GitProvider. Sempre grava `execution_result`,
 * nunca deixa a ação presa (mirror de ExecuteTerminal/ExecuteAdrPr).
 */
@Injectable()
export class ExecuteGitActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly engineClient: ApiToEngineClient,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    try {
      const result = await this.run(projectId, sessionId, action);
      return this.record(projectId, sessionId, action.id, 'executed', result);
    } catch (error) {
      await this.appendSessionEvent
        .execute(projectId, sessionId, {
          type: 'action.failed',
          actor: { kind: 'system', id: 'git-executor' },
          payload: {
            actionId: action.id,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => undefined);
      return this.markFailed(projectId, sessionId, action);
    }
  }

  private async run(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<GitActionExecutionResult> {
    const payload = action.payload as Record<string, unknown>;

    if (
      action.actionType === 'git_commit' ||
      action.actionType === 'git_push'
    ) {
      const r = await this.engineClient.executeGitAction(
        projectId,
        sessionId,
        action.id,
        action.actionType,
        payload,
      );
      return action.actionType === 'git_commit'
        ? {
            kind: 'git_commit',
            sha: str(r.sha),
            branch: str(r.branch),
          }
        : {
            kind: 'git_push',
            branch: str(r.branch, str(payload.branch)),
          };
    }

    // pr_open / git_merge — via GitProvider.
    const repo = await this.repositories.findByProjectId(projectId);
    if (!repo) throw new Error('Projeto sem repositório provisionado');
    const provider = this.gitProviders.get(repo.provider);
    let accessToken: string | undefined;
    if (repo.provider !== 'local' && action.decidedBy) {
      const secret = await this.userCredentials.findSecretByUserAndProvider(
        action.decidedBy,
        repo.provider,
      );
      if (secret) accessToken = this.encryption.decrypt(secret);
    }

    if (action.actionType === 'pr_open') {
      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: str(payload.sourceBranch),
        targetBranch: str(payload.targetBranch, repo.defaultBranch),
        title: str(payload.title, 'PR'),
        body: str(payload.body) || undefined,
        accessToken,
      });
      return {
        kind: 'pr_open',
        pullRequestUrl: pr.url,
        pullRequestId: pr.id,
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
      };
    }

    // git_merge (aprovação manual — a trava garante que nunca é auto).
    const merged = await provider.mergePullRequest({
      externalId: repo.externalId,
      pullRequestId: String(payload.pullRequestId),
      accessToken,
    });
    return {
      kind: 'git_merge',
      pullRequestId: merged.id,
      state: merged.state,
      targetBranch: merged.targetBranch,
    };
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: GitActionExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        {
          status,
          executionResult,
        },
      );
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: `action.${executionResult.kind}`,
        actor: { kind: 'system', id: 'git-executor' },
        payload: { actionId, ...executionResult },
      });
      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType: 'proposed_action.executed',
        payload: { actionId },
      });

      await this.settlePrOpen(projectId, sessionId, updated, status === 'executed');

      return updated;
    });
  }

  /**
   * Avisa o engine que o `pr_open` de um dev agent teve DESFECHO (Fase 12e).
   *
   * O gate deixou de ser aberto pelo agente logo depois de propor a PR: com
   * autonomia manual as três ações git ficam `pending`, e o gate abria assim
   * mesmo — o QA varria o worktree, aprovava, e a task fechava sem uma linha
   * commitada. Agora o agente espera em `awaiting_approval`, e é esta linha de
   * outbox que o solta.
   *
   * `aggregateType: 'task'` porque é o que o `Engine.Outbox.Drain` já drena
   * desde a Fase 12b — nenhum tipo novo de agregado.
   */
  private async settlePrOpen(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
    opened: boolean,
  ) {
    if (action.actionType !== 'pr_open') return;

    const taskId = (action.payload as { storyTaskId?: unknown }).storyTaskId;
    const agentId = action.actor?.id;
    // PR de infra e de ADR não têm task por trás — `storyTaskId` só existe no
    // `propose_pr` do dev agent.
    if (typeof taskId !== 'string' || !agentId) return;

    await this.outbox.append({
      aggregateType: 'task',
      aggregateId: taskId,
      eventType: 'task.pr_settled',
      payload: { projectId, sessionId, taskId, agentId, opened },
    });
  }

  private markFailed(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        action.id,
        {
          status: 'failed',
          executionResult: { kind: 'git_push', branch: '' },
        },
      );

      // Uma PR que FALHOU ao abrir também é desfecho: sem isto o agente
      // esperaria em `awaiting_approval` para sempre por um gate que nunca
      // vai abrir.
      await this.settlePrOpen(projectId, sessionId, updated, false);

      return updated;
    });
  }
}
