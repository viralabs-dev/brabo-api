import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ApplyInstructionVersionService } from '../instructions/apply-instruction-version.service';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import type { InstructionPatchExecutionResult } from '../../../domain/instructions/instruction-patch-execution-result';

interface InstructionPatchPayload {
  agent: string;
  fromVersion: number;
  proposedContent: string;
  rationale?: string;
  hypothesisId?: string | null;
}

/**
 * Executa um `instruction_patch` aprovado (Fase 4b — Anamnese): grava a
 * versão nova no histórico, atualiza o ponteiro que o engine lê e
 * invalida o cache de instruções. Mirror de ExecuteInfraPrUseCase —
 * nunca lança: falha vira `executionResult` `failed`, a ação nunca fica
 * presa.
 */
@Injectable()
export class ExecuteInstructionPatchUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
    private readonly outbox: OutboxRepository,
    private readonly applyInstruction: ApplyInstructionVersionService,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
  ): Promise<ProposedAction> {
    const payload = action.payload as InstructionPatchPayload;

    try {
      const applied = await this.applyInstruction.apply({
        projectId,
        agent: payload.agent,
        content: payload.proposedContent,
        createdBy: action.decidedBy,
        sourceActionId: action.id,
        sourceHypothesisId: payload.hypothesisId ?? null,
        note: payload.rationale ?? null,
      });

      if (!applied.changed) {
        return this.fail(
          projectId,
          sessionId,
          action,
          payload.agent,
          'conteúdo proposto é idêntico ao vigente — nada a aplicar',
        );
      }

      return this.record(projectId, sessionId, action.id, 'executed', {
        agent: payload.agent,
        fromVersion: applied.fromVersion,
        toVersion: applied.toVersion,
        versionId: applied.versionId ?? '',
        cacheInvalidated: applied.cacheInvalidated,
      });
    } catch (error) {
      return this.fail(
        projectId,
        sessionId,
        action,
        payload.agent,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private fail(
    projectId: string,
    sessionId: string,
    action: ProposedAction,
    agent: string,
    message: string,
  ) {
    return this.record(
      projectId,
      sessionId,
      action.id,
      'failed',
      {
        agent,
        fromVersion: 0,
        toVersion: 0,
        versionId: '',
        cacheInvalidated: false,
      },
      message,
    );
  }

  private record(
    projectId: string,
    sessionId: string,
    actionId: string,
    status: 'executed' | 'failed',
    executionResult: InstructionPatchExecutionResult,
    failureMessage?: string,
  ) {
    return this.unitOfWork.runInTransaction(async () => {
      const updated = await this.proposedActions.updateExecutionResult(
        actionId,
        { status, executionResult },
      );

      await this.appendSessionEvent.execute(projectId, sessionId, {
        type:
          status === 'executed' ? 'instruction.patched' : 'instruction.patch_failed',
        actor: { kind: 'system', id: 'action-executor' },
        payload: {
          actionId,
          agent: executionResult.agent,
          fromVersion: executionResult.fromVersion,
          toVersion: executionResult.toVersion,
          cacheInvalidated: executionResult.cacheInvalidated,
          ...(failureMessage ? { reason: failureMessage } : {}),
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
