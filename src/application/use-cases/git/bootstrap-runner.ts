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
      // Fora do `try` porque o `catch` precisa dela: uma etapa que morre no
      // `check` não chegou a virar "mais uma tentativa", e a contagem que
      // vale é a que a linha já trazia.
      let attemptNumber = initialStep === step.step ? initialAttempts : 0;

      try {
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

        attemptNumber += 1;
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
            // A linha e o evento `bootstrap.step_failed` NÃO saem daqui: quem
            // declara a etapa fracassada é o `catch` da etapa, logo abaixo, um
            // lugar só. Este bloco cuida do que é da MUTAÇÃO — o desfecho da
            // ação proposta que representa exatamente esta escrita no provider.
            throw error;
          }
        }

        bootstrap = await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'done',
          attempts: 0,
          lastError: null,
        });
      } catch (error) {
        // O ÚNICO lugar que declara a etapa fracassada — e a razão de existir
        // é o que ficava DE FORA antes: `step.check(ctx)` não estava em
        // try/catch nenhum, e ele faz IO de rede (`getFileContent`,
        // `listBranches`). Um 401 de token expirado, um 403 ou um timeout ali
        // subiam sem tocar na linha, que continuava `pending` com
        // `lastError: NULL` — `deriveProvisioningStatus` devolvia
        // `provisioning`, a tela dizia "Trabalhando…" e pollava para sempre.
        // Falha que não vira estado durável é falha que nenhuma tela consegue
        // contar, e o event log fica sem o desfecho.
        const message = error instanceof Error ? error.message : String(error);
        // A LINHA antes do evento, de propósito: é ela que o endpoint de
        // status lê, e ela precisa existir mesmo que o append também falhe —
        // quando o motivo é o banco, os dois falham pelo mesmo motivo.
        await this.repoBootstraps.update(projectId, {
          step: step.step,
          status: 'failed',
          attempts: attemptNumber,
          lastError: message,
        });
        await this.appendSessionEvent.execute(projectId, sessionId, {
          type: 'bootstrap.step_failed',
          actor: BOOTSTRAP_ACTOR,
          payload: { step: step.step, error: message },
        });
        throw error;
      }
    }

    return bootstrap;
  }
}
