import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import { ProvarRedeDoContainerUseCase } from '../containers/provar-rede-do-container.use-case';
import { SubirCicloDeVidaDoContainerUseCase } from '../containers/subir-ciclo-de-vida-do-container.use-case';
import { PortaDoAppUseCase } from '../containers/porta-do-app.use-case';
import { RegistroDeRecursos } from '../containers/registro-de-recursos';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ObterRedeDoContainerUseCase } from '../containers/obter-rede-do-container.use-case';
import { DeclararRedeDoContainerUseCase } from '../containers/declarar-rede-do-container.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
} from '../../ports/container-broker.port';
import type { ContainerStopOuRemoveExecutionResult } from '../../../domain/containers/container-stop-remove-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * Executa `container_recreate` aprovado (AT-608, ADR 0228, RN-934): `remove` +
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
    private readonly provarRede: ProvarRedeDoContainerUseCase,
    private readonly obterRede?: ObterRedeDoContainerUseCase,
    private readonly declararRede?: DeclararRedeDoContainerUseCase,
    private readonly portaDoApp?: PortaDoAppUseCase,
    private readonly registro?: RegistroDeRecursos,
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

      // AT-758 (RN-1029) + ADR 0298 (RN-1383): o clique de quem aprovou declara a
      // rede da proposta `app_declared` (só se não houver rede vigente, RN-932) e
      // confere a porta no host DE NOVO: tomada depois da proposta, grava rede
      // NOVA com a porta livre (ator = quem clicou). ANTES do `remove`: se a rede
      // for recusada, o container antigo segue de pé.
      const portas = (action.payload as { ports?: unknown } | null)?.ports;
      const vigente = await this.obterRede?.execute(projectId);
      const base =
        Array.isArray(portas) && portas.length > 0
          ? (portas as Array<{
              host: number;
              container: number;
              protocol: string;
            }>)
          : (vigente?.ports ?? []);
      let nota: string | undefined;
      let ports = base;
      if (this.portaDoApp && base.length > 0) {
        const trocadas: string[] = [];
        ports = [];
        for (const p of base) {
          const quem = await this.portaDoApp.quemSegura(projectId, p.host);
          if (!quem) {
            ports.push(p);
            continue;
          }
          const { porta } = await this.portaDoApp.escolher(projectId);
          trocadas.push(`${p.host} (com ${quem}) -> ${porta}`);
          ports.push({ ...p, host: porta });
        }
        if (trocadas.length > 0) {
          nota = `porta tomada depois da proposta: ${trocadas.join(', ')}`;
        }
      }
      if (ports.length > 0 && action.decidedBy && (!vigente || nota)) {
        await this.declararRede!.execute(projectId, action.decidedBy, {
          ...(vigente
            ? { dns: vigente.dns, extraHosts: vigente.extraHosts }
            : {}),
          ports,
        });
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
      await this.registro?.removido(projectId, 'container');

      await this.registro?.pedido(projectId, 'container', '', ports);
      try {
        const iniciado = await this.brokerPort.start(projectId);
        // RN-1366: rede provada antes de `running` (o ciclo está `removed`).
        const prova = await this.provarRede.execute(projectId);
        if (!prova.ok) {
          await this.registro?.falhou(projectId, 'container', '', prova.motivo);
          return this.fail(
            projectId,
            sessionId,
            action.id,
            `O container foi removido, mas a subida falhou: ${prova.motivo}`,
          );
        }
        await this.subirCicloDeVida.execute(
          projectId,
          iniciado.containerId,
          true,
        );
        await this.registro?.criado(
          projectId,
          'container',
          '',
          iniciado.containerId,
        );
      } catch (erro) {
        if (
          erro instanceof BrokerRecusouError ||
          erro instanceof BrokerIndisponivelError
        ) {
          // O container antigo já foi descartado: o registro diz `removed`,
          // e o motivo diz que a subida é que falhou.
          await this.registro?.falhou(projectId, 'container', '', erro.message);
          return this.fail(
            projectId,
            sessionId,
            action.id,
            `O container foi removido, mas a subida falhou: ${erro.message}`,
          );
        }
        throw erro;
      }

      return this.record(
        projectId,
        sessionId,
        action.id,
        'executed',
        { motivo: null, statusFinal: 'running' },
        nota,
      );
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
    nota?: string,
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
          ...(nota && { portaPulada: nota }),
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
