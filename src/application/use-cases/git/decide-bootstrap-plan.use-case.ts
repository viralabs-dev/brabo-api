import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { TransitionSessionUseCase } from '../sessions/transition-session.use-case';
import type {
  BootstrapStepName,
  BootstrapStepStatus,
  RepoBootstrap,
} from '../../../domain/git/repo-bootstrap.entity';
import type { ProvisionedRepository } from '../../../domain/git/provisioned-repository.entity';
import { BootstrapRunner } from './bootstrap-runner';

export interface DecideBootstrapPlanInput {
  /**
   * O `generatedAt` do plano que o usuário VIU. Guarda otimista: se o
   * plano tiver sido regerado desde então (readoção, ou o repositório
   * mudou), a decisão é recusada em vez de aplicar um "sim" dado sobre
   * outra coisa.
   */
  planGeneratedAt: string;
}

export interface DecideBootstrapPlanResult {
  repository: ProvisionedRepository;
  bootstrap: { step: BootstrapStepName; status: BootstrapStepStatus };
}

/**
 * As duas saídas do plano de adoção (Fase 12a, RN-045).
 *
 * O PORTÃO fica aqui, antes do runner — não como filtro dentro dele. O
 * `BootstrapRunner` continua idêntico ao da Fase 2; o que muda é que,
 * num repositório adotado, ninguém o chama enquanto não houver
 * `plan_decision = 'approved'`. Somado ao guard que já existia em
 * `bootstrap-steps.ts` (branch protegida é pulada), não há caminho de
 * código que proteja uma branch fora de um plano aprovado.
 */
@Injectable()
export class DecideBootstrapPlanUseCase {
  constructor(
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly sessions: SessionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly transitionSession: TransitionSessionUseCase,
    private readonly bootstrapRunner: BootstrapRunner,
  ) {}

  /** Aprova o plano INTEIRO e roda o bootstrap. */
  async approve(
    projectId: string,
    userId: string,
    input: DecideBootstrapPlanInput,
  ): Promise<DecideBootstrapPlanResult> {
    const { repository, bootstrap } = await this.carregar(projectId, input);

    const provider = this.gitProviders.get(repository.provider);
    const accessToken = await this.resolverCredencial(
      userId,
      repository.provider,
    );

    await this.repoBootstraps.recordPlanDecision(projectId, 'approved', userId);
    await this.appendSessionEvent.execute(projectId, bootstrap.sessionId, {
      type: 'bootstrap.plan_approved',
      actor: { kind: 'user', id: userId },
      payload: {
        planGeneratedAt: input.planGeneratedAt,
        passos: bootstrap.plan?.steps.length ?? 0,
      },
    });

    // Roda o runner SEM filtro: o `check()` de cada passo relê o remoto,
    // então o conjunto executado é o plano RE-DERIVADO — igual ou menor
    // que o exibido, nunca maior. Uma branch que tenha virado protegida
    // entre a aprovação e a execução é simplesmente pulada.
    const executado = await this.bootstrapRunner.run(projectId, bootstrap, {
      provider,
      externalId: repository.externalId,
      defaultBranch: repository.defaultBranch,
      accessToken,
    });

    await this.fecharSessao(projectId, executado.sessionId);
    return {
      repository,
      bootstrap: { step: executado.step, status: executado.status },
    };
  }

  /**
   * Adota COMO ESTÁ: o bootstrap é dispensado por decisão explícita.
   *
   * O cursor NÃO é adulterado para fingir convergência — é justamente o
   * que o seed manual da Fase 10 fazia à mão ("marcada como convergida
   * para o produto não tentar retomar bootstrap nenhum"). Aqui a decisão
   * registrada é que torna o projeto operável, e
   * `deriveProvisioningStatus` a respeita. O plano fica guardado como
   * evidência do que deliberadamente não foi aplicado.
   */
  async adoptAsIs(
    projectId: string,
    userId: string,
    input: DecideBootstrapPlanInput,
  ): Promise<DecideBootstrapPlanResult> {
    const { repository, bootstrap } = await this.carregar(projectId, input);

    const decidido = await this.repoBootstraps.recordPlanDecision(
      projectId,
      'as_is',
      userId,
    );
    await this.appendSessionEvent.execute(projectId, bootstrap.sessionId, {
      type: 'bootstrap.adopted_as_is',
      actor: { kind: 'user', id: userId },
      payload: {
        planGeneratedAt: input.planGeneratedAt,
        passosDispensados: bootstrap.plan?.steps.length ?? 0,
      },
    });

    await this.fecharSessao(projectId, bootstrap.sessionId);
    return {
      repository,
      bootstrap: { step: decidido.step, status: decidido.status },
    };
  }

  private async carregar(
    projectId: string,
    input: DecideBootstrapPlanInput,
  ): Promise<{ repository: ProvisionedRepository; bootstrap: RepoBootstrap }> {
    const repository = await this.repositories.findByProjectId(projectId);
    const bootstrap = await this.repoBootstraps.findByProjectId(projectId);
    if (!repository || !bootstrap) {
      throw new NotFoundException('Projeto sem repositório adotado');
    }
    if (repository.origin !== 'adopted') {
      throw new ConflictException(
        'Plano de bootstrap só existe para repositório adotado',
      );
    }
    if (!bootstrap.plan || !bootstrap.planGeneratedAt) {
      throw new ConflictException(
        'Nenhum plano gerado para este projeto — adote o repositório primeiro',
      );
    }
    if (bootstrap.planDecision) {
      throw new ConflictException(
        `O plano já foi decidido (${bootstrap.planDecision}) — readote o repositório para gerar um plano novo`,
      );
    }
    if (bootstrap.planGeneratedAt.toISOString() !== input.planGeneratedAt) {
      throw new ConflictException(
        'O plano foi regerado desde que você o viu — recarregue e decida sobre o plano atual',
      );
    }
    return { repository, bootstrap };
  }

  private async resolverCredencial(
    userId: string,
    provider: ProvisionedRepository['provider'],
  ): Promise<string | undefined> {
    if (provider === 'local') return undefined;
    const secret = await this.userCredentials.findSecretByUserAndProvider(
      userId,
      provider,
    );
    if (!secret) {
      throw new ConflictException(
        `Usuário sem credencial ${provider} cadastrada — cadastre antes de aprovar o plano`,
      );
    }
    return this.encryption.decrypt(secret);
  }

  /** Mesma cautela do provisionamento: só fecha o que ainda está aberto. */
  private async fecharSessao(
    projectId: string,
    sessionId: string,
  ): Promise<void> {
    const session = await this.sessions.findInProject(projectId, sessionId);
    if (session?.status !== 'active') return;
    await this.transitionSession.execute(projectId, sessionId, 'closing');
    await this.transitionSession.execute(projectId, sessionId, 'closed');
  }
}
