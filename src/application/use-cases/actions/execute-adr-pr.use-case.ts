import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { AdrPrExecutionResult } from '../../../domain/git/adr-pr-execution-result';

interface AdrPayload {
  title: string;
  slug: string;
  content: string;
}

/**
 * Executa uma ação `open_adr_pr` aprovada: cria a branch `feature/adr-<slug>`,
 * commita `docs/adr/<slug>.md` no repo DO PROJETO e abre uma PR real via o
 * GitProvider da Fase 2. O usuário depois revisa/mergeia a PR no provider. Só
 * chamado quando a ação acabou de ficar approved/auto_approved (mirror de
 * ExecuteTerminalActionUseCase — grava executionResult, nunca deixa presa).
 */
@Injectable()
export class ExecuteAdrPrUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
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
    const payload = action.payload as AdrPayload;
    const branch = `feature/adr-${payload.slug}`;
    const path = `docs/adr/${payload.slug}.md`;

    try {
      const repo = await this.repositories.findByProjectId(projectId);
      if (!repo) {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          'Projeto sem repositório provisionado',
        );
      }

      const provider = this.gitProviders.get(repo.provider);
      let accessToken: string | undefined;
      if (repo.provider !== 'local') {
        const secret = action.decidedBy
          ? await this.userCredentials.findSecretByUserAndProvider(
              action.decidedBy,
              repo.provider,
            )
          : null;
        if (!secret) {
          return this.fail(
            projectId,
            sessionId,
            action.id,
            `Sem credencial ${repo.provider} do aprovador para abrir a PR`,
          );
        }
        accessToken = this.encryption.decrypt(secret);
      }

      await provider.createBranch({
        externalId: repo.externalId,
        branchName: branch,
        fromRef: repo.defaultBranch,
        accessToken,
      });
      await provider.commitFiles({
        externalId: repo.externalId,
        branch,
        message: `docs(adr): ${payload.title}`,
        files: [{ path, content: payload.content }],
        accessToken,
      });
      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: branch,
        targetBranch: repo.defaultBranch,
        title: payload.title,
        body: `ADR proposta pelo Arquiteto.\n\nArquivo: \`${path}\``,
        accessToken,
      });

      const result: AdrPrExecutionResult = {
        pullRequestUrl: pr.url,
        pullRequestId: String(pr.id),
        branch,
        path,
        title: payload.title,
      };
      return this.record(projectId, sessionId, action.id, 'executed', result);
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private fail(
    projectId: string,
    sessionId: string,
    actionId: string,
    message: string,
  ) {
    return this.record(projectId, sessionId, actionId, 'failed', {
      pullRequestUrl: '',
      pullRequestId: '',
      branch: '',
      path: '',
      title: message,
    });
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: AdrPrExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: status === 'executed' ? 'adr.pr_opened' : 'adr.pr_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: {
          actionId,
          pullRequestUrl: executionResult.pullRequestUrl,
          title: executionResult.title,
        },
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType:
          status === 'executed'
            ? 'proposed_action.executed'
            : 'proposed_action.failed',
        payload: { actionId },
      });

      return updated;
    });
  }
}
