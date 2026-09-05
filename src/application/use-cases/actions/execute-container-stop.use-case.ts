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
 * Executa uma ação `container_stop` aprovada (ADR 0136, RN-495) — a página
 * global de containers pedindo para PARAR o container de um projeto.
 *
 * Mais simples que `ExecuteContainerStartUseCase`: não decide imagem
 * nenhuma, só pede ao broker (`ContainerBrokerPort.stop`, ADR 0130 — sem
 * chamador até este PR) e registra a transição correspondente.
 *
 * `ContainerBrokerPort.stop`/`DockerPort.stop` já são idempotentes do lado
 * do broker (parar o que já não está rodando é no-op) — o que este caso de
 * uso decide é se REGISTRA uma transição depois: só faz sentido gravar
 * `running -> stopped` quando o registrado ainda dizia `running`. Fora
 * disso (já `stopped`, ou nunca provisionado) o broker foi chamado (é
 * seguro, é idempotente) mas a tabela não se move — inventar uma transição
 * que a máquina de estados não descreveu de verdade seria o mesmo defeito
 * que RN-486 já nomeou para o observado: registrar o que não aconteceu.
 *
 * ## `runner` (ADR 0137, RN-503)
 *
 * Mesma ramificação por DESTINO de `ExecuteContainerStartUseCase`:
 * `container` e `mounted` vão ao BROKER; só `runner` pede ao ENGINE para
 * repassar `container_stop` ao RUNNER conectado via canal. "Sem runner
 * conectado"/"timeout" (`RunnerNaoConectadoError`) e "o runner recusou"
 * (`RunnerRecusouContainerError`) são FALHAS NORMAIS, mesma disciplina do
 * broker.
 *
 * `mounted` mudou de lado junto com o `start` (RN-503), e tinha de mudar: o
 * container de um projeto montado passou a subir NO SERVIDOR, e um `stop`
 * que continuasse indo pelo runner pediria para parar um container que não
 * existe na máquina do usuário — deixando de pé, sem forma de parar, o que
 * está de pé no servidor.
 */
@Injectable()
export class ExecuteContainerStopUseCase {
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
          'Não há container registrado para este projeto — nada para parar.',
        );
      }

      if (project.executionMode !== 'runner') {
        try {
          await this.brokerPort.stop(projectId);
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
          await this.apiToEngineClient.stopContainerViaRunner(
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

      const statusFinal =
        atual.status === 'running'
          ? (await this.registrarTransicao.execute(projectId, 'stopped')).status
          : atual.status;

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        statusFinal,
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
          status === 'executed' ? 'container.stopped' : 'container.stop_failed',
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
