import { Injectable } from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

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
