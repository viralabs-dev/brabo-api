import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { ResolveCredentialOwnerUseCase } from '../llm/resolve-credential-owner.use-case';
import { TaskRepository } from '../../ports/backlog-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type {
  GitActionExecutionResult,
  GitActionFailureResult,
} from '../../../domain/git/git-action-execution-result';
import { GitMergeConflictError } from '../../../domain/git/git-errors';
import { BRANCH_DE_TRABALHO } from '../../../domain/actions/protected-branches';

// Coerção segura de campos `unknown` (payload/resultado do engine) para
// string — evita o `[object Object]` que o String(unknown) permitiria.
function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

const KINDS_DE_ACAO_GIT = new Set([
  'git_commit',
  'git_push',
  'pr_open',
  'git_merge',
]);

/**
 * O resultado gravado na ação que falhou (RN-705): o `kind` é o tipo da ação
 * (antes era sempre `git_push`), com o motivo e, no conflito de merge, os
 * arquivos — é daí que a aba PRs lê a última recusa de merge de cada PR.
 */
export function resultadoDaFalha(
  action: ProposedAction,
  error: unknown,
): GitActionFailureResult {
  const kind = KINDS_DE_ACAO_GIT.has(action.actionType)
    ? (action.actionType as GitActionFailureResult['kind'])
    : 'git_push';
  const resultado: GitActionFailureResult = {
    kind,
    failed: true,
    error: error instanceof Error ? error.message : String(error),
  };
  const prId = (action.payload as { pullRequestId?: unknown }).pullRequestId;
  if (typeof prId === 'string') resultado.pullRequestId = prId;
  if (error instanceof GitMergeConflictError) {
    resultado.conflictingFiles = error.conflictingFiles;
  }
  return resultado;
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
    private readonly resolveOwner: ResolveCredentialOwnerUseCase,
    private readonly tasks: TaskRepository,
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
      return this.markFailed(projectId, sessionId, action, error);
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
    if (repo.provider !== 'local') {
      // A credencial é do OWNER do workspace, não de quem decidiu a ação.
      //
      // Resolver por `action.decidedBy` funcionava só quando um humano
      // clicava: ação AUTO-APROVADA por política não tem decisor, o campo
      // fica NULL, o token fica `undefined`, e o GitHub responde
      // `Requires authentication`. Na prática, com autonomia ligada —
      // que é o modo que a Fase F existe para viabilizar — nenhum dev agent
      // conseguia abrir PR em provider remoto (achado AA da FASE 13b).
      //
      // Nunca apareceu antes porque toda validação anterior usou o
      // `LocalGitProvider`, onde o token não é consultado.
      //
      // É a mesma resposta da RN-058 para chave de LLM, e pelo mesmo motivo:
      // quem banca a conta banca os agentes, e isso não muda conforme quem
      // clica. O caminho do engine (`git_auth.ex`, RN-076) já fazia assim —
      // era a api que estava fora de simetria, e é por isso que no mesmo run
      // o `git_push` passava e o `pr_open` falhava.
      const dono = await this.resolveOwner.execute(projectId);
      const secret = await this.userCredentials.findSecretByUserAndProvider(
        dono,
        repo.provider,
      );
      if (secret) accessToken = this.encryption.decrypt(secret);
    }

    if (action.actionType === 'pr_open') {
      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: str(payload.sourceBranch),
        // RN-664: o dev agent manda `targetBranch: 'dev'` explícito; o default
        // cobre a ação proposta antes disso (sem o campo), que ia para
        // `repo.defaultBranch` (`main`) e pulava a esteira.
        targetBranch: str(payload.targetBranch, BRANCH_DE_TRABALHO),
        title: str(payload.title, 'PR'),
        body: str(payload.body) || undefined,
        accessToken,
        // RN-705: o provider local grava o autor (`<agente>[bot]`, a mesma
        // identidade dos commits dos agentes).
        author:
          action.actor?.kind === 'agent' && action.actor.id
            ? `${action.actor.id}[bot]`
            : undefined,
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

      await this.settlePrOpen(
        projectId,
        sessionId,
        updated,
        status === 'executed',
      );
      if (status === 'executed') {
        await this.settleMerge(projectId, sessionId, actionId, executionResult);
      }

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

  /**
   * O merge executado fecha a(s) tarefa(s) da PR (AT-275, RN-628).
   *
   * Sem isto a tarefa ficava em `in_review` para sempre: o gate de QA/SecOps
   * termina em `awaiting_user` e ninguém mais mexia no `status`. Só roda
   * DEPOIS do merge que o humano aprovou (RN-418 — nada aqui mergeia) e só com
   * `state: 'merged'`. A tarefa é achada pelo `pr_open` que a abriu
   * (`storyTaskId` no payload, `pullRequestId` no resultado).
   *
   * IDEMPOTENTE por construção: `markDoneIfNotDone` é um UPDATE condicional, e
   * o evento imutável (`backlog.task_status_changed`) só é gravado quando a
   * linha de fato mudou — merge repetido da mesma PR não move de novo nem
   * duplica evento. Não consulta o gate (AT-249: gate pendente só AVISA, na
   * tela). Merge de PR já mergeada não chega aqui: a proposta e a aprovação o
   * recusam com 409 `pr_ja_mergeado`, e o `LocalGitProvider` também (RN-663).
   */
  private async settleMerge(
    projectId: string,
    sessionId: string,
    actionId: string,
    result: GitActionExecutionResult,
  ) {
    if (
      result.kind !== 'git_merge' ||
      !('state' in result) ||
      result.state !== 'merged'
    )
      return;

    const taskIds = await this.tarefasDaPr(projectId, result.pullRequestId);

    for (const taskId of taskIds) {
      const task = await this.tasks.markDoneIfNotDone(taskId);
      if (!task) continue;
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'backlog.task_status_changed',
        actor: { kind: 'system', id: 'git-executor' },
        payload: {
          taskId,
          status: 'done',
          cause: 'pr_merged',
          pullRequestId: result.pullRequestId,
          actionId,
        },
      });
    }
  }

  /** As tarefas cujo `pr_open` abriu esta PR (`storyTaskId` no payload). */
  private async tarefasDaPr(
    projectId: string,
    pullRequestId: string,
  ): Promise<Set<string>> {
    const prActions = await this.proposedActions.listByProjectAndType(
      projectId,
      'pr_open',
    );
    const taskIds = new Set<string>();
    for (const a of prActions) {
      const r = a.executionResult;
      const taskId = (a.payload as { storyTaskId?: unknown }).storyTaskId;
      if (
        r &&
        'kind' in r &&
        r.kind === 'pr_open' &&
        'pullRequestUrl' in r &&
        r.pullRequestId === pullRequestId &&
        typeof taskId === 'string'
      ) {
        taskIds.add(taskId);
      }
    }
    return taskIds;
  }

  private markFailed(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
    error: unknown,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        action.id,
        {
          status: 'failed',
          executionResult: resultadoDaFalha(action, error),
        },
      );

      // Uma PR que FALHOU ao abrir também é desfecho: sem isto o agente
      // esperaria em `awaiting_approval` para sempre por um gate que nunca
      // vai abrir.
      await this.settlePrOpen(projectId, sessionId, updated, false);

      // RN-705: o conflito de merge vira evento NOMEADO na tarefa da PR —
      // antes a tarefa ficava `in_review` sem nada dizer que o merge falhou.
      const falha = resultadoDaFalha(action, error);
      if (falha.kind === 'git_merge' && falha.conflictingFiles) {
        const taskIds = await this.tarefasDaPr(
          projectId,
          falha.pullRequestId ?? '',
        );
        for (const taskId of taskIds) {
          await this.appendSessionEvent.execute(projectId, sessionId, {
            type: 'backlog.task_merge_conflict',
            actor: { kind: 'system', id: 'git-executor' },
            payload: {
              taskId,
              pullRequestId: falha.pullRequestId,
              conflictingFiles: falha.conflictingFiles,
              actionId: action.id,
            },
          });
        }
      }

      return updated;
    });
  }
}
