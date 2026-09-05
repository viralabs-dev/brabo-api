import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ObterSpecDeContainerUseCase } from '../containers/obter-spec-de-container.use-case';
import { SubirCicloDeVidaDoContainerUseCase } from '../containers/subir-ciclo-de-vida-do-container.use-case';
import {
  ApiToEngineClient,
  RunnerNaoConectadoError,
  RunnerRecusouContainerError,
  type ContainerIniciadoViaRunner,
} from '../../ports/api-to-engine-client.port';
import type { ContainerStartExecutionResult } from '../../../domain/containers/container-start-execution-result';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';

/**
 * Executa `container_start_via_runner` aprovada (RN-506, ADR 0145) —
 * segundo caminho para subir o container real do projeto, EXCLUSIVO de
 * `execution_mode: runner`. Extraído de `ExecuteContainerStartUseCase`, que
 * até esta entrega também atendia `runner` (via `executeViaRunner`) apesar
 * do payload de `container_start` nunca ter feito sentido para ele — ver o
 * docblock daquele arquivo.
 *
 * Não ELEGE imagem nenhuma: a que sobe é a que já estiver DECIDIDA
 * (`ObterSpecDeContainerUseCase` — o MESMO caso de uso que compõe `GET
 * .../container-spec` para o broker, chamado direto aqui, sem HTTP, porque
 * os dois rodam no mesmo processo da api). Não há roteamento de módulos
 * contra o qual eleger: o broker nunca alcança a pasta de um projeto
 * `runner` (ela mora na máquina do usuário), então `route_modules_to_infra`
 * não candidata nada para este caminho.
 *
 * O ENGINE repassa ao RUNNER conectado, via canal Phoenix
 * (`container_start`/`container_start_result`, mesmo par de
 * `exec`/`exec_result`) — `ApiToEngineClient.startContainerViaRunner`, sem
 * mudança nenhuma nesse contrato. "Sem runner conectado"
 * (`RunnerNaoConectadoError`) e "o runner recusou"
 * (`RunnerRecusouContainerError`) são FALHAS NORMAIS — nunca lançam para
 * fora, viram `failed` nomeado, mesma disciplina de
 * `BrokerIndisponivelError`/`BrokerRecusouError` no caminho do broker
 * (`ExecuteContainerStartUseCase`).
 *
 * A dança de ciclo de vida (`provisioning -> running`) é COMPARTILHADA com
 * `ExecuteContainerStartUseCase` via `SubirCicloDeVidaDoContainerUseCase` —
 * ver o docblock dela para o racional completo da máquina de estados.
 *
 * Sem materialização de pasta nenhuma aqui: a pasta de um projeto `runner`
 * mora na máquina do usuário, confirmada pelo próprio CLI conectando
 * (`workspace_verified_at`) — nada para este caso de uso criar.
 *
 * `action.payload.rationale` (opcional) não é lido aqui — é contexto para o
 * HUMANO decidir no `ApprovalCard` (`apps/web/src/lib/aprovacoes.ts`), sem
 * destino nenhum na execução: diferente de `container_start`, não há
 * `rationale` de eleição para embutir em `artifact.project_image`, porque
 * não há eleição.
 */
@Injectable()
export class ExecuteContainerStartViaRunnerUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly obterSpec: ObterSpecDeContainerUseCase,
    private readonly apiToEngineClient: ApiToEngineClient,
    private readonly subirCicloDeVida: SubirCicloDeVidaDoContainerUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    try {
      const spec = await this.obterSpec.execute(projectId);
      if (!spec.imagem) {
        return this.fail(
          projectId,
          sessionId,
          action.id,
          'Ainda não há imagem decidida para este projeto (RN-105) — nada para subir.',
        );
      }

      let iniciado: ContainerIniciadoViaRunner;
      try {
        iniciado = await this.apiToEngineClient.startContainerViaRunner(
          projectId,
          {
            workspaceDirName: spec.workspaceDirName,
            projectSlug: spec.projectSlug,
            workspaceId: spec.workspaceId,
            imagem: spec.imagem.image,
            imagemVersao: spec.imagemVersao,
            rede: spec.imagem.network,
            cpus: spec.imagem.resources.cpus,
            memoriaMb: spec.imagem.resources.memoryMb,
            pidsLimit: spec.imagem.resources.pidsLimit,
          },
        );
      } catch (erro) {
        if (
          erro instanceof RunnerNaoConectadoError ||
          erro instanceof RunnerRecusouContainerError
        ) {
          return this.fail(
            projectId,
            sessionId,
            action.id,
            erro.message,
            spec.imagem.image,
            spec.imagemVersao,
          );
        }
        throw erro;
      }

      await this.subirCicloDeVida.execute(projectId, iniciado.containerId);

      return this.record(projectId, sessionId, action.id, 'executed', {
        motivo: null,
        imagem: spec.imagem.image,
        version: spec.imagemVersao,
        network: spec.imagem.network,
        resources: spec.imagem.resources,
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
