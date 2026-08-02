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
} from '../../../domain/git/repo-bootstrap.entity';
import { BootstrapRunner } from './bootstrap-runner';

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
    private readonly bootstrapRunner: BootstrapRunner,
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

    // Repositório ADOTADO não passa por aqui (Fase 12a, RN-045). Sem esta
    // guarda o caminho "os dois já existem" cairia direto no runner e
    // rodaria o bootstrap num repo de terceiro SEM plano aprovado —
    // exatamente o que a regra proíbe. Adoção tem fluxo próprio, com
    // portão humano.
    if (existingRepo?.origin === 'adopted') {
      throw new ConflictException(
        `O projeto adotou ${existingRepo.provider}:${existingRepo.externalId} — ` +
          'o bootstrap de um repositório adotado só roda por aprovação do plano',
      );
    }

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
          // Explícito, não pelo default da coluna: este é o caminho que
          // CRIA o repositório, e dizer isso aqui é o que faz a adoção
          // (origin: 'adopted') ser uma escolha visível (Fase 12a, RN-046).
          origin: 'created',
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

    bootstrap = await this.bootstrapRunner.run(projectId, bootstrap, {
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
}
