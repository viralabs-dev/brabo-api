import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
} from '../../ports/container-broker.port';
import {
  ApiToEngineClient,
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
} from '../../ports/api-to-engine-client.port';
import type { ContainerStopOuRemoveExecutionResult } from '../../../domain/containers/container-stop-remove-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * Executa uma ação `container_remove` aprovada (ADR 0136, RN-495) — a
 * página global de containers pedindo para DESCARTAR o container de um
 * projeto. Nunca auto-aprovável (teto absoluto em `decide.ts`): quem chega
 * aqui sempre passou por uma aprovação humana explícita, a cada vez.
 *
 * `ContainerBrokerPort.remove`/`DockerPort.remove` são `docker rm --force`
 * do lado do broker — removem mesmo um container `running`, numa chamada só
 * (para o daemon, e stop+rm viram uma operação). A máquina de estados de
 * `container-lifecycle.ts` NÃO tem `running -> removed` direto (só
 * `running -> stopped/failed`, e só DAÍ para `removed`) — este caso de uso
 * registra os DOIS hops quando o registrado ainda dizia `running`, refletindo
 * o que aconteceu de verdade do lado do Docker sem alargar a máquina de
 * estados por uma via de atalho que só existe aqui.
 *
 * ## `runner` (ADR 0137, RN-503)
 *
 * Mesma ramificação por DESTINO de `ExecuteContainerStartUseCase`/
 * `ExecuteContainerStopUseCase`: `container` e `mounted` vão ao BROKER; só
 * `runner` pede ao ENGINE para repassar `container_remove` ao RUNNER
 * conectado via canal. `mounted` mudou de lado junto com o `start` (RN-503)
 * — o container dele passou a existir no SERVIDOR, e um `remove` pelo runner
 * deixaria órfão no servidor um container que a tabela diria `removed`.
 */
@Injectable()
export class ExecuteContainerRemoveUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
    private readonly brokerPort: ContainerBrokerPort,
    private readonly projects: ProjectRepository,
    private readonly apiToEngineClient: ApiToEngineClient,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const project = await this.projects.findById(projectId);
    if (!project) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        'Projeto não encontrado.',
      );
    }

    try {
      const atual = await this.obterCicloDeVida.execute(projectId);
      if (!atual || atual.status === 'removed') {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          'Não há container registrado para este projeto — nada para remover.',
        );
      }

      if (project.executionMode !== 'runner') {
        try {
          await this.brokerPort.remove(projectId);
        } catch (erro) {
          if (
            erro instanceof BrokerRecusouError ||
            erro instanceof BrokerIndisponivelError
          ) {
            return this.fail(projectId, sessionId, action.id, erro.message);
          }
          throw erro;
        }
      } else {
        try {
          await this.apiToEngineClient.removeContainerViaRunner(
            projectId,
            project.workspaceDirName,
          );
        } catch (erro) {
          if (
            erro instanceof RunnerNaoConectadoError ||
            erro instanceof RunnerRecusouContainerError
          ) {
            return this.fail(projectId, sessionId, action.id, erro.message);
          }
          throw erro;
        }
      }

      if (atual.status === 'running') {
        await this.registrarTransicao.execute(projectId, 'stopped');
      }
      const removido = await this.registrarTransicao.execute(
        projectId,
        'removed',
      );

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        statusFinal: removido.status,
      });
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
    motivo: string,
  ) {
    return this.record(projectId, sessionId, actionId, 'failed', {
      motivo,
      statusFinal: null,
    });
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: ContainerStopOuRemoveExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed'
            ? 'container.removed'
            : 'container.remove_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: {
          actionId,
          statusFinal: executionResult.statusFinal,
          motivo: executionResult.motivo,
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
