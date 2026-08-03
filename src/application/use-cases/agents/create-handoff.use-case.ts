import { BadRequestException, Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  assertHandoffTargetAllowed,
  HandoffToSubagentError,
} from '../../../domain/agents/agent-areas';

export interface CreateHandoffInput {
  fromAgent: string;
  toAgent: string;
  artifactId?: string | null;
}

/**
 * Cria um handoff OFFERED — chamado pelo engine (endpoint interno) quando o
 * Criativo emite o product_brief e oferece o handoff ao PO. A api é dona da
 * tabela `handoffs` (o engine nunca escreve tabela da api direto). Registra
 * também o session_event `handoff.offered` imutável.
 *
 * É o ÚNICO lugar do sistema que grava `toAgent`, e por isso é aqui que a
 * regra de alvo do ADR 0038 é aplicada: handoff externo endereça só lead de
 * área ou agente sem área. A `offer_handoff` do engine repassa `to_agent` como
 * string livre, então sem esta guarda um agente podia se dirigir direto a
 * `qa-automacao` e furar a hierarquia — a validação que o ADR mandou fazer e
 * que nunca tinha sido implementada (achado #12 do primeiro dogfooding).
 */
@Injectable()
export class CreateHandoffUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    input: CreateHandoffInput,
  ) {
    // Antes do INSERT: um handoff recusado não pode deixar linha nem evento.
    // `BadRequestException` porque quem chama é o engine, por rota interna —
    // 400 diz "o pedido está errado", que é o caso, e o erro tipado viaja no
    // corpo para o agente saber a quem se dirigir.
    try {
      assertHandoffTargetAllowed(input.toAgent);
    } catch (error) {
      if (error instanceof HandoffToSubagentError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const handoff = await this.handoffs.create({
      sessionId,
      projectId,
      fromAgent: input.fromAgent,
      toAgent: input.toAgent,
      artifactId: input.artifactId ?? null,
      status: 'offered',
    });

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'handoff.offered',
      actor: { kind: 'agent', id: input.fromAgent },
      payload: {
        handoffId: handoff.id,
        toAgent: input.toAgent,
        artifactId: handoff.artifactId,
      },
    });

    return handoff;
  }
}
