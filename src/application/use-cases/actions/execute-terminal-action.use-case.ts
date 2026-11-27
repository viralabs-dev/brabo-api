import { Injectable, Logger } from '@nestjs/common';
import { InstanciaDeQaUseCase } from '../containers/instancia-de-qa.use-case';
import { GetRunInstructionsUseCase } from '../execution/get-run-instructions.use-case';
import { mascararSaida } from '../../../domain/actions/mascara-da-saida';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  commandFromPayload,
  cwdFromPayload,
} from '../../../domain/actions/pattern-for-action';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { TerminalExecutionResult } from '../../../domain/actions/terminal-execution-result';

/**
 * Compartilhado por propose/approve/approve-always: só chamado quando uma
 * ação `terminal` acabou de ficar approved/auto_approved. Chama o engine
 * SÍNCRONO fora de transação (mesmo padrão de
 * TransitionSessionUseCase.activate) — falha de transporte vira `failed`
 * gravado normalmente, nunca deixa a ação presa em approved/auto_approved
 * sem desfecho.
 */
@Injectable()
export class ExecuteTerminalActionUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly engineClient: ApiToEngineClient,
    private readonly instanciaDeQa?: InstanciaDeQaUseCase,
    private readonly instrucoes?: GetRunInstructionsUseCase,
  ) {}

  private readonly logger = new Logger(ExecuteTerminalActionUseCase.name);

  /**
   * AT-612 (RN-938): `payload.alvo` só vale para o `qa-automacao` e para tarefa
   * DO PROJETO da ação; senão é descartado em log nomeado.
   */
  private async alvoDeQa(
    projectId: string,
    action: ProposedAction,
  ): Promise<{ qa: true; taskId: string } | undefined> {
    const alvo = (
      action.payload as { alvo?: { qa?: unknown; taskId?: unknown } } | null
    )?.alvo;
    if (alvo === undefined || alvo === null) return undefined;
    const motivo =
      action.actor.id !== 'qa-automacao'
        ? 'ator não é o qa-automacao'
        : alvo.qa !== true || typeof alvo.taskId !== 'string'
          ? 'alvo malformado'
          : null;
    if (motivo === null && this.instanciaDeQa) {
      try {
        const taskId = await this.instanciaDeQa.resolverTarefa(
          projectId,
          alvo.taskId as string,
        );
        return { qa: true, taskId };
      } catch {
        /* tarefa fora do projeto: cai no descarte */
      }
    }
    this.logger.warn(
      `terminal.alvo_de_qa_descartado action=${action.id} ator=${action.actor.id}: ${motivo ?? 'tarefa não pertence ao projeto'}`,
    );
    return undefined;
  }

  /** AT-1038 (RN-1549): `run.env` e o `env` dos serviços de QA, os valores que a saída não pode guardar. */
  private async variaveisDeclaradas(projectId: string) {
    if (!this.instrucoes) return [];
    try {
      const run = await this.instrucoes.execute(projectId);
      return [
        run?.env ?? {},
        ...(run?.qa?.services ?? []).map((s) => s.env ?? {}),
      ];
    } catch (error) {
      // Sem as variáveis, a senha em URL ainda é escondida.
      this.logger.warn(
        `terminal.mascara_sem_variaveis projeto=${projectId}: ${error instanceof Error ? error.name : 'erro'}`,
      );
      return [];
    }
  }

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const command = commandFromPayload(action.payload);
    const cwd = cwdFromPayload(action.payload);

    const variaveis = await this.variaveisDeclaradas(projectId);
    let result: TerminalExecutionResult;
    try {
      result = await this.engineClient.executeTerminalAction(
        projectId,
        sessionId,
        action.id,
        command,
        cwd,
        await this.alvoDeQa(projectId, action),
      );
    } catch (error) {
      return this.recordResult(projectId, sessionId, action.id, 'failed', {
        stdout: '',
        stderr: mascararSaida(
          error instanceof Error ? error.message : String(error),
          variaveis,
        ),
        exitCode: null,
        timedOut: false,
        rawBytes: 0,
        estimatedTokensRaw: 0,
        compressedBytes: null,
        estimatedTokensCompressed: null,
      });
    }

    const status = result.exitCode === 0 ? 'executed' : 'failed';
    return this.recordResult(projectId, sessionId, action.id, status, {
      ...result,
      stdout: mascararSaida(result.stdout, variaveis),
      stderr: mascararSaida(result.stderr, variaveis),
    });
  }

  private recordResult(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: TerminalExecutionResult,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: status === 'executed' ? 'action.executed' : 'action.failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: { actionId, exitCode: executionResult.exitCode },
      });

      await this.outbox.append({
        aggregateType: 'proposed_action',
        aggregateId: actionId,
        eventType:
          status === 'executed'
            ? 'proposed_action.executed'
            : 'proposed_action.failed',
        payload: { actionId, exitCode: executionResult.exitCode },
      });

      return updated;
    });
  }
}
