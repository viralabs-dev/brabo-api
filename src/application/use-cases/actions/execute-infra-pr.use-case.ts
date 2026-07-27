import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { GitBranchAlreadyExistsError } from '../../../domain/git/git-errors';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { UserCredentialRepository } from '../../ports/user-credential-repository.port';
import { EncryptionService } from '../../ports/encryption.port';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { InfraPrExecutionResult } from '../../../domain/git/infra-pr-execution-result';

interface InfraFilePayload {
  path: string;
  content: string;
}

interface InfraPrPayload {
  title: string;
  files: InfraFilePayload[];
}

const INFRA_BRANCH = 'feature/infra-setup';

/**
 * Normaliza o `path` que o MODELO escolheu para cada arquivo.
 *
 * `commitFiles` do provider local passa o path direto pro `git update-index
 * --cacheinfo`, que rejeita caminho absoluto — e o InfraAgent produziu
 * `/api/Dockerfile` na execução do critério de aceite, derrubando a PR inteira
 * com um `Command failed: git ... update-index` opaco (ADR 0021). Barra à
 * esquerda é intenção inequívoca de "raiz do repo": normalizar é seguro.
 *
 * Travessia (`..`) NÃO é normalizada — é recusada, com mensagem clara. Aqui o
 * conteúdo vem de um LLM, e escrever fora do repositório nunca é intenção
 * legítima.
 */
export function normalizeInfraPath(path: string): string {
  const limpo = path.trim().replace(/^\/+/, '');

  if (limpo === '') {
    throw new Error('arquivo de infra com `path` vazio');
  }
  if (limpo.split('/').includes('..')) {
    throw new Error(`arquivo de infra com caminho de travessia: "${path}"`);
  }
  return limpo;
}

/**
 * Executa uma ação `open_infra_pr` aprovada (Fase 4a — InfraAgent): commita os
 * N arquivos de infra (Dockerfiles/compose/CI) na branch `feature/infra-setup`
 * do repo DO PROJETO e abre uma PR real via o GitProvider da Fase 2. Mirror de
 * ExecuteAdrPrUseCase, generalizado pra múltiplos arquivos num único commit
 * (GitProvider.commitFiles já aceita `files: {path,content}[]`).
 */
@Injectable()
export class ExecuteInfraPrUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly gitProviders: GitProviderRegistry,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly userCredentials: UserCredentialRepository,
    private readonly encryption: EncryptionService,
    private readonly infraArtifacts: InfraArtifactRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const payload = action.payload as InfraPrPayload;
    const branch = INFRA_BRANCH;
    let files: InfraFilePayload[];
    try {
      files = payload.files.map((f) => ({
        ...f,
        path: normalizeInfraPath(f.path),
      }));
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        payload.files.map((f) => f.path),
        error instanceof Error ? error.message : String(error),
      );
    }
    const paths = files.map((f) => f.path);

    try {
      const repo = await this.repositories.findByProjectId(projectId);
      if (!repo) {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          paths,
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
            paths,
            `Sem credencial ${repo.provider} do aprovador para abrir a PR`,
          );
        }
        accessToken = this.encryption.decrypt(secret);
      }

      // Uma sessão só produz UM ciclo de PR de infra — se já existe um
      // artefato pra esta sessão, esta chamada é uma CORREÇÃO (o gate
      // pediu mudanças): reaproveita a branch/PR já abertas, só commita os
      // arquivos corrigidos de novo (sem createBranch/openPullRequest de
      // novo, sem nova linha em infra_artifacts).
      const existing = await this.infraArtifacts.findBySessionId(sessionId);

      if (!existing) {
        // Idempotente de propósito. A branch é criada ANTES do artefato
        // existir (ele só é gravado no sucesso), então qualquer falha entre
        // os dois — commit inválido, PR recusada — deixava a sessão
        // PERMANENTEMENTE travada: sem artefato, toda tentativa seguinte caía
        // aqui de novo e morria com "branch já existe". Visto na execução do
        // critério de aceite, com 5 tentativas seguidas falhando (ADR 0021).
        try {
          await provider.createBranch({
            externalId: repo.externalId,
            branchName: branch,
            fromRef: repo.defaultBranch,
            accessToken,
          });
        } catch (error) {
          if (!(error instanceof GitBranchAlreadyExistsError)) throw error;
        }
      }

      await provider.commitFiles({
        externalId: repo.externalId,
        branch,
        message: `chore(infra): ${payload.title}`,
        files,
        accessToken,
      });

      if (existing) {
        const original = await this.originalExecutionResult(
          projectId,
          existing.prActionId,
        );
        return this.record(projectId, sessionId, action.id, 'executed', {
          pullRequestUrl: original?.pullRequestUrl ?? '',
          pullRequestId: original?.pullRequestId ?? '',
          branch,
          paths,
          title: payload.title,
        });
      }

      const pr = await provider.openPullRequest({
        externalId: repo.externalId,
        sourceBranch: branch,
        targetBranch: repo.defaultBranch,
        title: payload.title,
        body: `Artefatos de infra propostos pelo InfraAgent.\n\nArquivos:\n${paths.map((p) => `- \`${p}\``).join('\n')}`,
        accessToken,
      });

      const result: InfraPrExecutionResult = {
        pullRequestUrl: pr.url,
        pullRequestId: String(pr.id),
        branch,
        paths,
        title: payload.title,
      };
      return this.record(projectId, sessionId, action.id, 'executed', result);
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        paths,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async originalExecutionResult(
    projectId: string,
    prActionId: string,
  ): Promise<InfraPrExecutionResult | null> {
    const actions = await this.proposedActions.listByProjectAndType(
      projectId,
      'open_infra_pr',
    );
    const original = actions.find((a) => a.id === prActionId);
    const result = original?.executionResult;
    return result && 'pullRequestUrl' in result
      ? (result as InfraPrExecutionResult)
      : null;
  }

  private fail(
    projectId: string,
    sessionId: string,
    actionId: string,
    paths: string[],
    message: string,
  ) {
    return this.record(projectId, sessionId, actionId, 'failed', {
      pullRequestUrl: '',
      pullRequestId: '',
      branch: '',
      paths,
      title: message,
    });
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: InfraPrExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: status === 'executed' ? 'infra.pr_opened' : 'infra.pr_failed',
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

      // PR aberta com sucesso: nasce o artefato de infra já em
      // 'awaiting_qa' — diferente de Task (que existe ANTES da PR e abre o
      // gate depois via OpenGateUseCase), aqui a PR é o próprio nascimento.
      if (status === 'executed') {
        await this.infraArtifacts.create({
          projectId,
          sessionId,
          title: executionResult.title,
          prActionId: actionId,
        });
      }

      return updated;
    });
  }
}
