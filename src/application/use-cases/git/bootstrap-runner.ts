import { Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { RepoBootstrapRepository } from '../../ports/repo-bootstrap-repository.port';
import { OutboxRepository } from '../../ports/outbox-repository.port';
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import type { Actor } from '../../../domain/sessions/session-event.entity';
import type { RepoBootstrap } from '../../../domain/git/repo-bootstrap.entity';
import {
  BOOTSTRAP_STEP_SEQUENCE,
  type BootstrapStepCtx,
} from './bootstrap-steps';

const BOOTSTRAP_ACTOR: Actor = { kind: 'system', id: 'git-bootstrap' };

/**
 * O executor do bootstrap de Gitflow — extraído VERBATIM de
 * `ProvisionRepositoryUseCase.runBootstrapSteps` na Fase 12a, sem uma
 * linha de comportamento alterada. A prova da extração fiel é
 * `provision-repository.use-case.spec.ts` continuar passando sem
 * modificação nenhuma (idempotência 3× e retomada inclusas).
 *
 * Existe como colaborador próprio porque a adoção (Fase 12a) precisa
 * rodar os mesmos passos DEPOIS de um plano aprovado. A alternativa —
 * `ApproveBootstrapPlanUseCase` dependendo de `ProvisionRepositoryUseCase`
 * — arrastaria onze dependências e diria, no grafo de módulos, que
 * adoção depende de provisionamento, que é exatamente o que esta fase
 * existe para negar.
 *
 * NÃO ganha modo dry-run: o diagnóstico é `bootstrap-plan.ts`, que chama
 * o mesmo `check()` sem nunca tocar `run()`. Um booleano que desliga os
 * seis pontos de efeito colateral daqui não seria uma flag — seriam dois
 * métodos com um `if` no meio.
 */
@Injectable()
export class BootstrapRunner {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repoBootstraps: RepoBootstrapRepository,
    private readonly outbox: OutboxRepository,
    private readonly proposedActions: ProposedActionRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async run(
    projectId: string,
    initialBootstrap: RepoBootstrap,
    ctx: BootstrapStepCtx,
  ): Promise<RepoBootstrap> {
    let bootstrap = initialBootstrap;
    const initialStep = initialBootstrap.step;
    const initialAttempts = initialBootstrap.attempts;
    const sessionId = bootstrap.sessionId;

    for (const step of BOOTSTRAP_STEP_SEQUENCE) {
      const pending = await step.check(ctx);

      if (pending === 'capability_unsupported') {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'bootstrap.step_degraded',
          actor: BOOTSTRAP_ACTOR,
          payload: {
            step: step.step,
            reason: 'capability_unsupported',
            provider: ctx.provider.name,
          },
        });
        bootstrap = await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'done',
          attempts: 0,
          lastError: null,
        });
        continue;
      }

      if (pending.length === 0) {
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'bootstrap.step_skipped',
          actor: BOOTSTRAP_ACTOR,
          payload: { step: step.step, reason: 'already_satisfied' },
        });
        bootstrap = await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'done',
          attempts: 0,
          lastError: null,
        });
        continue;
      }

      const attemptNumber =
        (initialStep === step.step ? initialAttempts : 0) + 1;
      bootstrap = await this.repoBootstraps.update(projectId, {
        step: step.step,
        status: 'running',
        attempts: attemptNumber,
        lastError: null,
      });
      await this.appendSessionEvent.execute(projectId, sessionId, {
        type: 'bootstrap.step_started',
        actor: BOOTSTRAP_ACTOR,
        payload: { step: step.step },
      });

      for (const mutation of pending) {
        const proposedAction = await this.unitOfWork.runInTransaction(
          async () => {
            const created = await this.proposedActions.create({
              projectId,
              sessionId,
              actionType: mutation.actionType,
              payload: mutation.payload,
              status: 'auto_approved',
              resolvedPolicy: 'auto_approve',
              actor: BOOTSTRAP_ACTOR,
            });
            await this.outbox.append({
              aggregateType: 'proposed_action',
              aggregateId: created.id,
              eventType: 'proposed_action.created',
              payload: {
                actionType: mutation.actionType,
                status: 'auto_approved',
              },
            });
            return created;
          },
        );

        try {
          const detail = await mutation.run(ctx);
          await this.unitOfWork.runInTransaction(async () => {
            await this.proposedActions.updateExecutionResult(
              proposedAction.id,
              {
                status: 'executed',
                executionResult: { kind: 'git_bootstrap', detail },
              },
            );
          });
          await this.appendSessionEvent.execute(projectId, sessionId, {
            type: 'bootstrap.step_completed',
            actor: BOOTSTRAP_ACTOR,
            payload: { step: step.step, ...detail },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.unitOfWork.runInTransaction(async () => {
            await this.proposedActions.updateExecutionResult(
              proposedAction.id,
              {
                status: 'failed',
                executionResult: {
                  kind: 'git_bootstrap',
                  detail: { error: message },
                },
              },
            );
          });
          await this.appendSessionEvent.execute(projectId, sessionId, {
            type: 'bootstrap.step_failed',
            actor: BOOTSTRAP_ACTOR,
            payload: { step: step.step, error: message },
          });
          await this.repoBootstraps.update(projectId, {
            step: step.step,
            status: 'failed',
            attempts: attemptNumber,
            lastError: message,
          });
          throw error;
        }
      }

      bootstrap = await this.repoBootstraps.update(projectId, {
        step: step.step,
        status: 'done',
        attempts: 0,
        lastError: null,
      });
    }

    return bootstrap;
  }
}
