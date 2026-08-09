import { ConflictException, Injectable } from '@nestjs/common';
import type { GitProviderName, GitRepo } from '@brabo/shared';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { CreateSessionUseCase } from '../sessions/create-session.use-case';
import { assertTransition } from '../../../domain/sessions/session-state-machine';
import {
  GitPermissionDeniedError,
  GitRepoNotFoundError,
} from '../../../domain/git/git-errors';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { ProvisionedRepository } from '../../../domain/git/provisioned-repository.entity';
import type { BootstrapPlan } from '../../../domain/git/repo-bootstrap.entity';
import { planBootstrap } from './bootstrap-plan';

export interface AdoptRepositoryInput {
  provider: GitProviderName;
  /** "owner/repo" (github), "namespace/path" (gitlab), path absoluto (local). */
  externalId: string;
}

export interface AdoptRepositoryResult {
  repository: ProvisionedRepository;
  plan: BootstrapPlan;
  /** Readoção do MESMO repo: nada foi criado, o plano foi regerado. */
  alreadyAdopted: boolean;
}

const ADOPTION_ACTOR: Actor = { kind: 'system', id: 'git-bootstrap' };

/**
 * Aponta um projeto para um repositório que JÁ EXISTE (Fase 12a).
 *
 * O achado P1 #1 do dogfooding: o produto só sabia criar, então a Fase
 * 10 precisou inserir à mão as linhas de `project_repositories` e
 * `repo_bootstraps`. Este caso de uso é essa operação feita direito.
 *
 * Duas garantias que os testes protegem:
 *
 * 1. **`createRepo` NUNCA é chamado.** Adoção valida acesso com
 *    `getRepo` — que existia desde a Fase 2 e nunca tinha sido usado por
 *    caso de uso nenhum — e nada mais.
 * 2. **Nada é executado no repositório.** O bootstrap não roda aqui: o
 *    que sai é um PLANO (dry-run) esperando decisão do usuário. Enquanto
 *    `plan_decision` for nulo, nenhuma mutação acontece (RN-045).
 */
@Injectable()
export class AdoptRepositoryUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly outbox: OutboxRepository,
    private readonly sessions: SessionRepository,
    // Sessão nasce SEMPRE pelo use case (RN-067): é ele que emite
    // `session.created` no outbox, e é esse evento que faz o engine subir o
    // SessionServer. Pelo `sessions.create` direto, a sessão fica sem processo.
    private readonly createSession: CreateSessionUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    userId: string,
    input: AdoptRepositoryInput,
  ): Promise<AdoptRepositoryResult> {
    const existing = await this.repositories.findByProjectId(projectId);
    this.assertPodeAdotar(existing, input);

    const provider = this.gitProviders.get(input.provider);

    let accessToken: string | undefined;
    if (input.provider !== 'local') {
      const secret = await this.userCredentials.findSecretByUserAndProvider(
        userId,
        input.provider,
      );
      if (!secret) {
        throw new ConflictException(
          `Usuário sem credencial ${input.provider} cadastrada — cadastre antes de adotar`,
        );
      }
      accessToken = this.encryption.decrypt(secret);
    }

    // Valida ACESSO antes de gravar qualquer coisa. Os erros do provider
    // já chegam distintos (404 vs 403) desde a Fase 2; aqui eles ganham
    // a mensagem que diz o que FAZER com cada um.
    const repoRemoto = await this.lerRepositorio(provider, {
      externalId: input.externalId,
      accessToken,
    });

    const repository =
      existing ??
      (await this.criarLinhas(projectId, userId, input, repoRemoto));

    // O dry-run roda SEMPRE, inclusive na readoção: o repositório pode
    // ter mudado desde a última vez, e um plano velho é pior que nenhum.
    const plan = await planBootstrap({
      provider,
      externalId: repository.externalId,
      defaultBranch: repository.defaultBranch,
      accessToken,
    });
    await this.repoBootstraps.savePlan(projectId, plan);

    return { repository, plan, alreadyAdopted: Boolean(existing) };
  }

  /**
   * Um projeto tem no máximo um repositório (unique em `project_id`).
   * Readotar o MESMO converge; qualquer outra combinação é conflito com
   * mensagem que diz para onde o projeto aponta hoje.
   */
  private assertPodeAdotar(
    existing: ProvisionedRepository | null,
    input: AdoptRepositoryInput,
  ): void {
    if (!existing) return;

    if (existing.origin === 'created') {
      throw new ConflictException(
        `O projeto já tem repositório criado pelo Brabo (${existing.provider}:${existing.externalId}) — ` +
          'adoção só vale para projeto sem repositório, ou para readotar o mesmo',
      );
    }
    if (
      existing.provider !== input.provider ||
      existing.externalId !== input.externalId
    ) {
      throw new ConflictException(
        `O projeto já adotou ${existing.provider}:${existing.externalId} — ` +
          'um projeto aponta para um repositório só',
      );
    }
  }

  private async lerRepositorio(
    provider: ReturnType<GitProviderRegistry['get']>,
    input: { externalId: string; accessToken?: string },
  ): Promise<GitRepo> {
    try {
      return await provider.getRepo(input);
    } catch (error) {
      // "não existe" e "existe mas sua credencial não alcança" levam a
      // ações OPOSTAS do usuário — conferir o identificador contra
      // trocar/ampliar a credencial. Diagnóstico por eliminação é o que
      // o ADR 0020 proíbe repetir.
      if (error instanceof GitRepoNotFoundError) {
        throw new GitRepoNotFoundError(
          `${input.externalId} — confira o identificador (owner/repo) e o provider`,
        );
      }
      if (error instanceof GitPermissionDeniedError) {
        throw new GitPermissionDeniedError(
          `${input.externalId} — o repositório existe, mas a credencial cadastrada não tem acesso; ` +
            'use uma credencial com permissão de leitura nele',
        );
      }
      throw error;
    }
  }

  private async criarLinhas(
    projectId: string,
    userId: string,
    input: AdoptRepositoryInput,
    repoRemoto: GitRepo,
  ): Promise<ProvisionedRepository> {
    // Mesmo motivo do provisionamento: adotar um repositório abre o projeto,
    // e o projeto executa. Ver RN-097.
    const session = await this.createSession.execute(projectId, userId, {
      kind: 'criativa',
    });

    const repository = await this.unitOfWork.runInTransaction(async () => {
      const repoRow = await this.repositories.create({
        projectId,
        provider: input.provider,
        externalId: repoRemoto.externalId,
        url: repoRemoto.url,
        defaultBranch: repoRemoto.defaultBranch,
        visibility: repoRemoto.visibility,
        origin: 'adopted',
        provisionedBy: userId,
      });
      await this.outbox.append({
        aggregateType: 'project',
        aggregateId: projectId,
        eventType: 'project.repository_adopted',
        payload: {
          provider: input.provider,
          externalId: repoRemoto.externalId,
        },
      });
      await this.repoBootstraps.create({
        projectId,
        sessionId: session.id,
        origin: 'adopted',
      });
      return repoRow;
    });

    // Mesma razão do provisionamento (ADR 0005): a sessão do bootstrap é
    // só event log, nunca roda comando — por isso `updateStatus` direto,
    // sem TransitionSessionUseCase, que notificaria o engine à toa.
    assertTransition('created', 'active');
    await this.sessions.updateStatus(session.id, 'active', null);

    await this.appendSessionEvent.execute(projectId, session.id, {
      type: 'bootstrap.repository_adopted',
      actor: ADOPTION_ACTOR,
      payload: {
        provider: input.provider,
        externalId: repoRemoto.externalId,
        defaultBranch: repoRemoto.defaultBranch,
      },
    });

    return repository;
  }
}
