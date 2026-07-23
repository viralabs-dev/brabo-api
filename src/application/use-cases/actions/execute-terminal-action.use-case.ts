import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { commandFromPayload } from '../../../domain/actions/pattern-for-action';
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
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const command = commandFromPayload(action.payload);

    let result: TerminalExecutionResult;
    try {
      result = await this.engineClient.executeTerminalAction(
        projectId,
        sessionId,
        action.id,
        command,
      );
    } catch (error) {
      return this.recordResult(projectId, sessionId, action.id, 'failed', {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: null,
        timedOut: false,
        rawBytes: 0,
        estimatedTokensRaw: 0,
        compressedBytes: null,
        estimatedTokensCompressed: null,
      });
    }

    const status = result.exitCode === 0 ? 'executed' : 'failed';
    return this.recordResult(projectId, sessionId, action.id, status, result);
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
