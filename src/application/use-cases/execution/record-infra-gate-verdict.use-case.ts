import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InfraArtifactRepository } from '../../ports/infra-artifact-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProvisionedRepositoryRepository } from '../../ports/provisioned-repository-repository.port';
import { GitProviderRegistry } from '../../ports/git-provider.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { MarkInfraArtifactBlockedUseCase } from './mark-infra-artifact-blocked.use-case';
import {
  nextGateStatus,
  type GateName,
  type GateVerdict,
} from '../../../domain/execution/pr-gate-state-machine';
import type { InfraArtifact } from '../../../domain/execution/infra-artifact.entity';
import { DEFAULT_MAX_GATE_CORRECTIONS } from './record-gate-verdict.use-case';
import type { GateNextAction } from './record-gate-verdict.use-case';

export interface RecordInfraGateVerdictInput {
  prActionId: string;
  gate: GateName;
  veredito: GateVerdict;
  resumo: string;
  itens: string[];
}

export interface RecordInfraGateVerdictResult {
  nextAction: GateNextAction;
  artifact: InfraArtifact;
}

/**
 * Mirror de RecordGateVerdictUseCase pro artefato de infra (Fase 4a —
 * InfraAgent): mesma nextGateStatus (domínio puro, agnóstico de Task),
 * contra InfraArtifactRepository em vez de TaskRepository. Chaveado por
 * `prActionId` (id da proposed_action `open_infra_pr`) — é o único id que o
 * engine conhece de volta, e é onde InfraPrExecutionResult.pullRequestId já
 * está direto (sem busca indireta por payload como no fluxo do dev).
 */
@Injectable()
export class RecordInfraGateVerdictUseCase {
  constructor(
    private readonly infraArtifacts: InfraArtifactRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly repositories: ProvisionedRepositoryRepository,
    private readonly gitProviders: GitProviderRegistry,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly markInfraArtifactBlocked: MarkInfraArtifactBlockedUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: RecordInfraGateVerdictInput,
    maxCorrections: number = DEFAULT_MAX_GATE_CORRECTIONS,
  ): Promise<RecordInfraGateVerdictResult> {
    const artifact = await this.infraArtifacts.findByPrActionId(
      input.prActionId,
    );
    if (!artifact) {
      throw new NotFoundException(
        `Artefato de infra da ação "${input.prActionId}" não encontrado`,
      );
    }
    if (artifact.blocked) {
      throw new BadRequestException(
        `Artefato de infra "${artifact.id}" já está bloqueado`,
      );
    }

    const transition = nextGateStatus(
      artifact.gateStatus,
      input.gate,
      input.veredito,
      artifact.gateCorrectionCount,
      maxCorrections,
    );

    await this.postComment(projectId, sessionId, input);

    let updatedArtifact: InfraArtifact;
    let nextAction: GateNextAction;

    if (transition.status === 'blocked') {
      updatedArtifact = await this.markInfraArtifactBlocked.execute(
        projectId,
        sessionId,
        artifact.id,
        'ciclo de correção esgotado (gate)',
        input.resumo,
        `${input.gate}-agent`,
      );
      nextAction = 'blocked';
    } else {
      updatedArtifact = await this.infraArtifacts.updateGateStatus(
        artifact.id,
        transition.status,
        transition.correctionCount,
      );
      nextAction =
        input.veredito === 'changes_requested'
          ? 'correct'
          : transition.status === 'awaiting_secops'
            ? 'run_secops'
            : 'done';
    }

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'infra.gate_changed',
      actor: { kind: 'agent', id: `${input.gate}-agent` },
      payload: {
        artifactId: artifact.id,
        gate: input.gate,
        veredito: input.veredito,
        gateStatus: updatedArtifact.gateStatus,
        blocked: updatedArtifact.blocked,
      },
    });

    return { nextAction, artifact: updatedArtifact };
  }

  // Best-effort, mesmo espírito de RecordGateVerdictUseCase — falha ao
  // comentar NUNCA trava a decisão do gate. Usa listByProjectAndType (não
  // findInSessionForUpdate, que é de uso exclusivo dentro de transação com
  // lock) já que só precisamos LER o executionResult.
  private async postComment(
    projectId: string,
    _sessionId: string,
    input: RecordInfraGateVerdictInput,
  ): Promise<void> {
    try {
      const repo = await this.repositories.findByProjectId(projectId);
      if (!repo) return;

      const prActions = await this.proposedActions.listByProjectAndType(
        projectId,
        'open_infra_pr',
      );
      const prAction = prActions.find((a) => a.id === input.prActionId);
      const executionResult = prAction?.executionResult;
      const pullRequestId =
        executionResult && 'pullRequestId' in executionResult
          ? executionResult.pullRequestId
          : undefined;
      if (!pullRequestId) return;

      const provider = this.gitProviders.get(repo.provider);
      await provider.commentOnPullRequest({
        externalId: repo.externalId,
        pullRequestId,
        body: commentBody(input),
      });
    } catch {
      // best-effort — ver comentário acima do método.
    }
  }
}

function commentBody(input: RecordInfraGateVerdictInput): string {
  const gateLabel = input.gate === 'qa' ? 'QA' : 'SecOps';
  const veredictoLabel =
    input.veredito === 'approved' ? 'Aprovado ✅' : 'Mudanças solicitadas ⚠️';
  const itens =
    input.itens.length > 0
      ? '\n' + input.itens.map((i) => `- ${i}`).join('\n')
      : '';
  return `### Parecer ${gateLabel} (PR de infra): ${veredictoLabel}\n\n${input.resumo}${itens}`;
}
