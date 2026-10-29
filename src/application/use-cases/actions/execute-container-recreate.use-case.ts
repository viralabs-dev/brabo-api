import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import { SubirCicloDeVidaDoContainerUseCase } from '../containers/subir-ciclo-de-vida-do-container.use-case';
import { ProjectRepository } from '../../ports/project-repository.port';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
} from '../../ports/container-broker.port';
import type { ContainerStopOuRemoveExecutionResult } from '../../../domain/containers/container-stop-remove-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * Executa `container_recreate` aprovado (AT-608, ADR 0228, RN-933): `remove` +
 * `start` pelo broker, para o container passar a valer com o comando do app e
 * a rede declarados (a spec só muda em container RECRIADO — o `start` é
 * idempotente). Passa pela máquina de estados de `project_containers`
 * (`running -> stopped -> removed -> provisioning -> running`); qualquer falha
 * vira `failed` NOMEADO, sem reiniciar nada por baixo. Teto absoluto em
 * `decide.ts`, como `container_remove`.
 *
 * `runner` é recusado nomeando "runner depois": a capacidade de portas/app no
 * `join` do runner é outra lane (ADR 0228, ponto 6).
 */
@Injectable()
export class ExecuteContainerRecreateUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
    private readonly subirCicloDeVida: SubirCicloDeVidaDoContainerUseCase,
    private readonly brokerPort: ContainerBrokerPort,
    private readonly projects: ProjectRepository,
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
    if (project.executionMode === 'runner') {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        'Recriar o container de um projeto `runner` ainda não existe (runner depois, ADR 0228).',
      );
    }

    try {
      const atual = await this.obterCicloDeVida.execute(projectId);
      if (!atual || atual.status === 'removed') {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          'Não há container registrado para este projeto — nada para recriar.',
        );
      }

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
      if (atual.status === 'running') {
        await this.registrarTransicao.execute(projectId, 'stopped');
      }
      await this.registrarTransicao.execute(projectId, 'removed');

      try {
        const iniciado = await this.brokerPort.start(projectId);
        await this.subirCicloDeVida.execute(projectId, iniciado.containerId);
      } catch (erro) {
        if (
          erro instanceof BrokerRecusouError ||
          erro instanceof BrokerIndisponivelError
        ) {
          // O container antigo já foi descartado: o registro diz `removed`,
          // e o motivo diz que a subida é que falhou.
          return this.fail(
            projectId,
            sessionId,
            action.id,
            `O container foi removido, mas a subida falhou: ${erro.message}`,
          );
        }
        throw erro;
      }

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        statusFinal: 'running',
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
            ? 'container.recreated'
            : 'container.recreate_failed',
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
