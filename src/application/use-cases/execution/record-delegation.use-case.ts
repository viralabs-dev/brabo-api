import { BadRequestException, Injectable } from '@nestjs/common';
import { DelegationRepository } from '../../ports/delegation-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertDelegationOutcomeWellFormed,
  DelegationPayloadInvalidoError,
} from '../../../domain/agents/delegation-invariants';
import type { DelegationStatus } from '../../../domain/agents/delegation.entity';
import type { FailureOrigin } from '../../../domain/agents/failure-origin';

export interface RecordDelegationInput {
  // `null`/ausente pra áreas sem task de backlog por trás (Infra, Fase 8c —
  // a delegação é sobre a SESSÃO). QA (Fase 8b) sempre manda.
  taskId?: string | null;
  area: string;
  leadAgent: string;
  subagent: string;
  status: DelegationStatus;
  parecerArtifactId?: string | null;
  failureOrigin?: FailureOrigin | null;
  failureReason?: string | null;
  justification?: string | null;
}

/**
 * Registra o desfecho de UMA delegação de área (Fase 8b QA, Fase 8c Infra —
 * ADR 0038): `completed` (com parecer), `failed` (com origem) ou `dispensed`
 * (com justificativa) — o lead da área chama isto uma vez por
 * subagente/delegado, SEPARADO da chamada que a área usa pra reportar o
 * resultado consolidado pra fora (`record_gate_verdict` pro QA,
 * `open_infra_pr` pro Infra). A api nunca vê o consolidado como delegação —
 * mesmo padrão de `CreateHandoffUseCase`: tabela + evento imutável, na
 * MESMA transação lógica.
 *
 * `taskId` é opcional: QA sempre manda (delegação é sobre uma task de
 * backlog); Infra nunca manda (delegação é sobre a SESSÃO — não existe task
 * por trás de uma PR de infra).
 *
 * Sem status `pending`: o lead resolve cada delegação síncrona, numa rodada
 * só, e só chama esta rota já com o desfecho final.
 */
@Injectable()
export class RecordDelegationUseCase {
  constructor(
    private readonly delegations: DelegationRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: RecordDelegationInput,
  ) {
    try {
      assertDelegationOutcomeWellFormed(input);
    } catch (error) {
      if (error instanceof DelegationPayloadInvalidoError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const delegation = await this.delegations.create({
      projectId,
      sessionId,
      taskId: input.taskId ?? null,
      area: input.area,
      leadAgent: input.leadAgent,
      subagent: input.subagent,
      status: input.status,
      parecerArtifactId: input.parecerArtifactId ?? null,
      failureOrigin: input.failureOrigin ?? null,
      failureReason: input.failureReason ?? null,
      justification: input.justification ?? null,
    });

    const payload = {
      delegationId: delegation.id,
      taskId: delegation.taskId,
      area: input.area,
      subagent: input.subagent,
      parecerArtifactId: delegation.parecerArtifactId,
      failureOrigin: delegation.failureOrigin,
      failureReason: delegation.failureReason,
      justification: delegation.justification,
    };
    const actor = { kind: 'agent' as const, id: input.leadAgent };

    // Três chamadas com `type` LITERAL, não `type: \`delegation.${status}\``
    // — `pnpm docs:generate` acha tipo de evento por regex sobre string
    // literal (`scripts/docs/generate.mjs`); um template escaparia da
    // varredura e os três tipos ficariam de fora do inventário gerado sem
    // ninguém notar.
    switch (input.status) {
      case 'completed':
        await this.appendEvent.execute(projectId, sessionId, {
          type: 'delegation.completed',
          actor,
          payload,
        });
        break;
      case 'failed':
        await this.appendEvent.execute(projectId, sessionId, {
          type: 'delegation.failed',
          actor,
          payload,
        });
        break;
      case 'dispensed':
        await this.appendEvent.execute(projectId, sessionId, {
          type: 'delegation.dispensed',
          actor,
          payload,
        });
        break;
    }

    return delegation;
  }
}
