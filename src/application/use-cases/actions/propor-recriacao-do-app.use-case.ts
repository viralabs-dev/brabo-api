import { Injectable } from '@nestjs/common';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { GetRunInstructionsUseCase } from '../execution/get-run-instructions.use-case';
import { ProposeActionUseCase } from './propose-action.use-case';
import { BRANCH_DE_TRABALHO } from '../../../domain/actions/protected-branches';
import { EVENTO_REDE_DO_CONTAINER } from '../../../domain/containers/rede-do-container';
import {
  motivoDeNaoRecriar,
  proximaPortaLivre,
} from '../../../domain/containers/recriar-com-app';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * AT-758, RN-1029: depois do merge na `main` da PR de infra cujo `run.app` é o
 * vigente, propõe o `container_recreate` (ator `agent/infra`) com a porta do
 * app. O teto de `decide.ts` mantém `pending`: o clique é humano (RN-934).
 * Chamado pelo `ApproveActionUseCase`, fora da transação e em melhor esforço.
 * Devolve a ação proposta, ou `null` (não era o caso, ou o motivo de não propor).
 */
@Injectable()
export class ProporRecriacaoDoAppUseCase {
  constructor(
    private readonly proposedActions: ProposedActionRepository,
    private readonly projects: ProjectRepository,
    private readonly eventos: SessionEventRepository,
    private readonly ciclo: ObterCicloDeVidaDoContainerUseCase,
    private readonly runInstructions: GetRunInstructionsUseCase,
    private readonly propose: ProposeActionUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    merge: ProposedAction,
  ): Promise<ProposedAction | null> {
    const r = merge.executionResult;
    if (
      merge.actionType !== 'git_merge' ||
      !r ||
      !('kind' in r) ||
      r.kind !== 'git_merge' ||
      !('state' in r) ||
      r.state !== 'merged' ||
      r.targetBranch !== BRANCH_DE_TRABALHO
    ) {
      return null;
    }
    const pullRequestId = r.pullRequestId;

    // A PR de infra mergeada declarou `run.app`? (mesma régua de `comAppDeclarado`)
    const infra = (
      await this.proposedActions.listByProjectAndType(
        projectId,
        'open_infra_pr',
      )
    ).find((a) => {
      const res = a.executionResult;
      return (
        a.status === 'executed' &&
        res !== null &&
        'pullRequestId' in res &&
        res.pullRequestId === pullRequestId &&
        Boolean((a.payload as { run?: { app?: unknown } } | null)?.run?.app)
      );
    });
    if (!infra) return null;

    // O vigente tem de ser o desta PR: uma PR de infra mais nova, ainda aberta,
    // traz um comando que não está na `main`.
    const vigente = await this.runInstructions.execute(projectId);
    const doInfra = infra.executionResult as { pullRequestUrl?: string };
    if (
      !vigente?.app ||
      !vigente.prUrl ||
      vigente.prUrl !== doInfra.pullRequestUrl
    ) {
      return null;
    }

    const [project, ciclo, recreates] = await Promise.all([
      this.projects.findById(projectId),
      this.ciclo.execute(projectId),
      this.proposedActions.listByProjectAndType(
        projectId,
        'container_recreate',
      ),
    ]);
    if (!project) return null;
    const motivo = motivoDeNaoRecriar({
      executionMode: project.executionMode,
      container: ciclo,
      recreatePendente: recreates.some((a) => a.status === 'pending'),
      declaradoEm: new Date(vigente.declaredAt),
    });
    if (motivo) return null;

    // shortcut: toda versão de rede de qualquer projeto conta como ocupada, e
    // recreate pendente de outro projeto ainda não; upgrade se a colisão aparecer.
    const redes = await this.eventos.listByType(EVENTO_REDE_DO_CONTAINER);
    const host = proximaPortaLivre(
      redes
        .flatMap((e) => {
          const ports = (e.payload as { ports?: unknown } | null)?.ports;
          return Array.isArray(ports)
            ? ports.map((p) => (p as { host?: unknown })?.host)
            : [];
        })
        .filter((h): h is number => typeof h === 'number'),
    );

    return this.propose.execute(projectId, sessionId, {
      actionType: 'container_recreate',
      actor: { kind: 'agent', id: 'infra' },
      payload: {
        reason: 'app_declared',
        pullRequestId,
        ports: [{ host, container: vigente.app.port, protocol: 'tcp' }],
      },
    });
  }
}
