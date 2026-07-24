import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { GitProviderName, GitRepo } from '@brabo/shared';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { TransitionSessionUseCase } from '../sessions/transition-session.use-case';
import { assertTransition } from '../../../domain/sessions/session-state-machine';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ProvisionedRepository } from '../../../domain/git/provisioned-repository.entity';
import type {
  BootstrapStepName,
  BootstrapStepStatus,
  RepoBootstrap,
} from '../../../domain/git/repo-bootstrap.entity';
import {
  BOOTSTRAP_STEP_SEQUENCE,
  type BootstrapStepCtx,
} from './bootstrap-steps';

export interface ProvisionRepositoryInput {
  provider: GitProviderName;
  name: string;
  visibility: 'public' | 'private';
  namespace?: string;
}

export interface ProvisionRepositoryResult {
  repository: ProvisionedRepository;
  bootstrap: { step: BootstrapStepName; status: BootstrapStepStatus };
}

const BOOTSTRAP_ACTOR: Actor = { kind: 'system', id: 'git-bootstrap' };

@Injectable()
export class ProvisionRepositoryUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly outbox: OutboxRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly sessions: SessionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly transitionSession: TransitionSessionUseCase,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    input: ProvisionRepositoryInput,
  ): Promise<ProvisionRepositoryResult> {
    // Sem guarda de "já convergiu vira 409" — bootstrap idempotente
    // significa literalmente "rodar de novo não falha" (CLAUDE.md): um
    // projeto já convergido só faz TODOS os passos reportarem satisfeito
    // (skip), nunca erro. Ver docs/adr/0005.
    const existingRepo = await this.repositories.findByProjectId(projectId);
    let bootstrap = await this.repoBootstraps.findByProjectId(projectId);

    // Provider/credencial resolvidos UMA vez, válidos tanto pro caminho
    // "cria do zero" quanto pra retomada (nesse caso, a partir do
    // provider já persistido, não do input — que pode nem ter sido
    // repassado de novo pelo chamador).
    const providerName = existingRepo?.provider ?? input.provider;
    const provider = this.gitProviders.get(providerName);

    let accessToken: string | undefined;
    if (providerName !== 'local') {
      const secret = await this.userCredentials.findSecretByUserAndProvider(
        userId,
        providerName,
      );
      if (!secret) {
        throw new ConflictException(
          `Usuário sem credencial ${providerName} cadastrada — cadastre antes de provisionar`,
        );
      }
      accessToken = this.encryption.decrypt(secret);
    }

    let repo: ProvisionedRepository;

    if (existingRepo && bootstrap) {
      repo = existingRepo;
    } else if (existingRepo) {
      // Repo existe mas o bootstrap nunca chegou a começar (não deveria
      // acontecer sob o fluxo novo, já que os dois nascem na mesma
      // transação — defensivo pra dados de uma versão anterior).
      repo = existingRepo;
      const session = await this.sessions.create({
        projectId,
        createdBy: userId,
      });
      bootstrap = await this.repoBootstraps.create({
        projectId,
        sessionId: session.id,
      });
    } else {
      const session = await this.sessions.create({
        projectId,
        createdBy: userId,
      });

      const proposedAction = await this.unitOfWork.runInTransaction(
        async () => {
          const created = await this.proposedActions.create({
            projectId,
            sessionId: session.id,
            actionType: 'git_repo_create',
            payload: {
              provider: providerName,
              name: input.name,
              visibility: input.visibility,
            },
            status: 'auto_approved',
            resolvedPolicy: 'auto_approve',
            actor: BOOTSTRAP_ACTOR,
          });
          await this.outbox.append({
            aggregateType: 'proposed_action',
            aggregateId: created.id,
            eventType: 'proposed_action.created',
            payload: { actionType: 'git_repo_create', status: 'auto_approved' },
          });
          return created;
        },
      );

      let created: GitRepo;
      try {
        created = await provider.createRepo({
          name: input.name,
          visibility: input.visibility,
          namespace: input.namespace,
          accessToken,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.unitOfWork.runInTransaction(async () => {
          await this.proposedActions.updateExecutionResult(proposedAction.id, {
            status: 'failed',
            executionResult: {
              kind: 'git_bootstrap',
              detail: { error: message },
            },
          });
        });
        throw error;
      }

      const txResult = await this.unitOfWork.runInTransaction(async () => {
        await this.proposedActions.updateExecutionResult(proposedAction.id, {
          status: 'executed',
          executionResult: {
            kind: 'git_bootstrap',
            detail: { externalId: created.externalId },
          },
        });
        const repoRow = await this.repositories.create({
          projectId,
          provider: providerName,
          externalId: created.externalId,
          url: created.url,
          defaultBranch: created.defaultBranch,
          visibility: input.visibility,
          provisionedBy: userId,
        });
        await this.outbox.append({
          aggregateType: 'project',
          aggregateId: projectId,
          eventType: 'project.repository_provisioned',
          payload: { provider: providerName, externalId: created.externalId },
        });
        const bootstrapRow = await this.repoBootstraps.create({
          projectId,
          sessionId: session.id,
        });
        return { repoRow, bootstrapRow };
      });

      repo = txResult.repoRow;
      bootstrap = txResult.bootstrapRow;
    }

    const session = await this.sessions.findInProject(
      projectId,
      bootstrap.sessionId,
    );
    if (!session)
      throw new NotFoundException('Sessão do bootstrap não encontrada');
    if (session.status === 'created') {
      // NUNCA via TransitionSessionUseCase — chamaria o engine indevidamente
      // pra uma sessão que nunca roda comando nenhum (é só o "event log"
      // do bootstrap). Ver docs/adr/0005.
      assertTransition('created', 'active');
      await this.sessions.updateStatus(session.id, 'active', null);
    }

    bootstrap = await this.runBootstrapSteps(projectId, bootstrap, {
      provider,
      externalId: repo.externalId,
      defaultBranch: repo.defaultBranch,
      accessToken,
    });

    // Só fecha se ainda estiver 'active' — uma re-execução idempotente
    // sobre um bootstrap já convergido encontra a sessão já 'closed'
    // (closing/closed nunca são destino de transição a partir de
    // 'closed', ver session-state-machine.ts) e não deve tentar de novo.
    const sessionBeforeClose = await this.sessions.findInProject(
      projectId,
      bootstrap.sessionId,
    );
    if (sessionBeforeClose?.status === 'active') {
      await this.transitionSession.execute(
        projectId,
        bootstrap.sessionId,
        'closing',
      );
      await this.transitionSession.execute(
        projectId,
        bootstrap.sessionId,
        'closed',
      );
    }

    return {
      repository: repo,
      bootstrap: { step: bootstrap.step, status: bootstrap.status },
    };
  }

  private async runBootstrapSteps(
    projectId: string,
    initialBootstrap: RepoBootstrap,
    ctx: BootstrapStepCtx,
  ): Promise<RepoBootstrap> {
    let bootstrap = initialBootstrap;
    const initialStep = initialBootstrap.step;
    const initialAttempts = initialBootstrap.attempts;
    const sessionId = bootstrap.sessionId;

    for (const step of BOOTSTRAP_STEP_SEQUENCE) {
      const pending = await step.check(ctx);

      if (pending === 'capability_unsupported') {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'bootstrap.step_degraded',
          actor: BOOTSTRAP_ACTOR,
          payload: {
            step: step.step,
            reason: 'capability_unsupported',
            provider: ctx.provider.name,
          },
        });
        bootstrap = await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'done',
          attempts: 0,
          lastError: null,
        });
        continue;
      }

      if (pending.length === 0) {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'bootstrap.step_skipped',
          actor: BOOTSTRAP_ACTOR,
          payload: { step: step.step, reason: 'already_satisfied' },
        });
        bootstrap = await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'done',
          attempts: 0,
          lastError: null,
        });
        continue;
      }

      const attemptNumber =
        (initialStep === step.step ? initialAttempts : 0) + 1;
      bootstrap = await this.repoBootstraps.update(projectId, {
        step: step.step,
        status: 'running',
        attempts: attemptNumber,
        lastError: null,
      });
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'bootstrap.step_started',
        actor: BOOTSTRAP_ACTOR,
        payload: { step: step.step },
      });

      for (const mutation of pending) {
        const proposedAction = await this.unitOfWork.runInTransaction(
          async () => {
            const created = await this.proposedActions.create({
              projectId,
              sessionId,
              actionType: mutation.actionType,
              payload: mutation.payload,
              status: 'auto_approved',
              resolvedPolicy: 'auto_approve',
              actor: BOOTSTRAP_ACTOR,
            });
            await this.outbox.append({
              aggregateType: 'proposed_action',
              aggregateId: created.id,
              eventType: 'proposed_action.created',
              payload: {
                actionType: mutation.actionType,
                status: 'auto_approved',
              },
            });
            return created;
          },
        );

        try {
          const detail = await mutation.run(ctx);
          await this.unitOfWork.runInTransaction(async () => {
            await this.proposedActions.updateExecutionResult(
              proposedAction.id,
              {
                status: 'executed',
                executionResult: { kind: 'git_bootstrap', detail },
              },
            );
          });
          await this.appendSessionEvent.execute(projectId, sessionId, {
            type: 'bootstrap.step_completed',
            actor: BOOTSTRAP_ACTOR,
            payload: { step: step.step, ...detail },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.unitOfWork.runInTransaction(async () => {
            await this.proposedActions.updateExecutionResult(
              proposedAction.id,
              {
                status: 'failed',
                executionResult: {
                  kind: 'git_bootstrap',
                  detail: { error: message },
                },
              },
            );
          });
          await this.appendSessionEvent.execute(projectId, sessionId, {
            type: 'bootstrap.step_failed',
            actor: BOOTSTRAP_ACTOR,
            payload: { step: step.step, error: message },
          });
          await this.repoBootstraps.update(projectId, {
            step: step.step,
            status: 'failed',
            attempts: attemptNumber,
            lastError: message,
          });
          throw error;
        }
      }

      bootstrap = await this.repoBootstraps.update(projectId, {
        step: step.step,
        status: 'done',
        attempts: 0,
        lastError: null,
      });
    }

    return bootstrap;
  }
}
