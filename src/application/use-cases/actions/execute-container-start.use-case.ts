import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { GetModuleRoutingUseCase } from '../architecture/get-module-routing.use-case';
import { DecidirImagemDoProjetoUseCase } from '../containers/decidir-imagem-do-projeto.use-case';
import { ObterCicloDeVidaDoContainerUseCase } from '../containers/obter-ciclo-de-vida-do-container.use-case';
import { RegistrarTransicaoDeContainerUseCase } from '../containers/registrar-transicao-de-container.use-case';
import {
  BrokerIndisponivelError,
  BrokerRecusouError,
  ContainerBrokerPort,
  type ContainerIniciadoPeloBroker,
} from '../../ports/container-broker.port';
import type {
  PosturaDeRede,
  RecursosDoContainer,
} from '../../../domain/containers/project-container';
import type { ContainerStartExecutionResult } from '../../../domain/containers/container-start-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

interface ContainerStartPayload {
  imagem: string;
  network: PosturaDeRede;
  resources: RecursosDoContainer;
  rationale: string;
}

/**
 * Executa uma ação `container_start` aprovada (ADR 0130/0133): a Infra
 * elegeu uma das imagens candidatadas pelo Arquiteto
 * (`route_modules_to_infra`) e este caso de uso (a) EMITE a nova versão de
 * `artifact.project_image` com essa eleição, reusando
 * `DecidirImagemDoProjetoUseCase` — é isso que faz a eleição da Infra ter
 * efeito real sobre o que o broker compõe, já que `GET
 * .../container-spec` lê `artifact.project_image`, nunca
 * `artifact.module_routing` — e (b) pede ao broker para subir o container
 * de verdade, registrando a transição de ciclo de vida correspondente.
 *
 * Mirror de `ExecuteInfraPrUseCase`: mesmo shell try/catch, mesmo par
 * record()/fail() gravando `updateExecutionResult` + evento de sessão +
 * outbox `proposed_action.executed`/`.failed`.
 */
@Injectable()
export class ExecuteContainerStartUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly getModuleRouting: GetModuleRoutingUseCase,
    private readonly decidirImagem: DecidirImagemDoProjetoUseCase,
    private readonly obterCicloDeVida: ObterCicloDeVidaDoContainerUseCase,
    private readonly registrarTransicao: RegistrarTransicaoDeContainerUseCase,
    private readonly brokerPort: ContainerBrokerPort,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const payload = action.payload as ContainerStartPayload;

    // A imagem eleita precisa ser uma das candidatas do roteamento VIGENTE
    // do Arquiteto — a Infra elege, nunca inventa. Isto acontece ANTES de
    // tocar em `artifact.project_image`: nunca gravar uma decisão para uma
    // imagem não validada.
    const roteamento = await this.getModuleRouting.execute(projectId);
    const candidatas = roteamento.roteamento.map((r) => r.imagemCandidata);
    if (!candidatas.includes(payload.imagem)) {
      return this.fail(
        projectId,
        sessionId,
        action.id,
        `Imagem "${payload.imagem}" não é uma das candidatas do roteamento ` +
          `vigente do Arquiteto (${candidatas.join(', ') || 'nenhuma'}) — a ` +
          'Infra elege entre as candidatas, nunca inventa uma imagem.',
      );
    }

    try {
      const decidida = await this.decidirImagem.execute(
        projectId,
        sessionId,
        {
          image: payload.imagem,
          rationale: `Eleita entre as candidatas do roteamento do Arquiteto: ${payload.rationale}`,
          network: payload.network,
          resources: payload.resources,
        },
        'infra-lead',
      );

      let iniciado: ContainerIniciadoPeloBroker;
      try {
        iniciado = await this.brokerPort.start(projectId);
      } catch (erro) {
        if (
          erro instanceof BrokerRecusouError ||
          erro instanceof BrokerIndisponivelError
        ) {
          return this.fail(
            projectId,
            sessionId,
            action.id,
            erro.message,
            decidida.decisao.image,
            decidida.version,
          );
        }
        throw erro;
      }

      // A dança provisioning -> running, e por que `stopped` pula direto
      // para `running`:
      //
      // A máquina de estados (`container-lifecycle.ts`) exige que a
      // PRIMEIRA linha de um projeto nasça em `provisioning` — é essa
      // transição que lê a decisão de imagem vigente (a que acabamos de
      // gravar acima) e CONGELA `imageVersion`/`resources` na linha nova.
      // Sem linha ainda, ou com a linha marcada `failed`/`removed` (as duas
      // sem container de pé), replicamos esse ciclo completo:
      // `provisioning` (nasce/renasce a linha) e só então `running` (o
      // broker confirmou que subiu).
      //
      // `stopped` já tem linha viva com `imageVersion` gravado — reprovisionar
      // reemitiria uma imagem que pode já estar desatualizada em relação à que
      // acabamos de decidir, e a máquina de estados nem permite `stopped ->
      // provisioning` (só `stopped -> running/failed/removed`). Por isso vai
      // direto para `running`: é o broker reconectando a um container que a
      // tabela já sabia que existia, não provisionando um novo.
      //
      // `provisioning`/`running` já vivos: o broker é idempotente
      // (`jaEstavaDePe`) — só falta completar a transição pendente
      // (`provisioning -> running`) ou não fazer nada (já `running`).
      const atual = await this.obterCicloDeVida.execute(projectId);
      if (!atual || atual.status === 'failed' || atual.status === 'removed') {
        await this.registrarTransicao.execute(projectId, 'provisioning');
      }
      if (!atual || atual.status !== 'running') {
        await this.registrarTransicao.execute(projectId, 'running', {
          containerId: iniciado.containerId,
        });
      }
      // atual.status === 'running': nada a transicionar, já está de pé.

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        imagem: decidida.decisao.image,
        version: decidida.version,
        network: decidida.decisao.network,
        resources: decidida.decisao.resources,
        containerId: iniciado.containerId,
        jaEstavaDePe: iniciado.jaEstavaDePe,
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
    imagem = '',
    version = 0,
  ) {
    return this.record(projectId, sessionId, actionId, 'failed', {
      motivo,
      imagem,
      version,
      network: null,
      resources: null,
      containerId: null,
      jaEstavaDePe: false,
    });
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: ContainerStartExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed'
            ? 'container.started'
            : 'container.start_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: {
          actionId,
          imagem: executionResult.imagem,
          containerId: executionResult.containerId,
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
