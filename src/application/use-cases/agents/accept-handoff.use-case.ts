import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HandoffRepository } from '../../ports/handoff-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { ActivateAgentUseCase } from './activate-agent.use-case';

/**
 * O usuário aceita um handoff oferecido — transiciona offered→accepted, grava
 * `handoff.accepted` e ATIVA o agente destino (PO). A regra de ativação
 * (agent-activation) exige um handoff accepted endereçado ao agente — que
 * passa a existir exatamente por esta aceitação.
 */
@Injectable()
export class AcceptHandoffUseCase {
  constructor(
    private readonly handoffs: HandoffRepository,
    private readonly appendEvent: AppendSessionEventUseCase,
    private readonly activateAgent: ActivateAgentUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    handoffId: string,
    userId: string,
  ) {
    const handoff = await this.handoffs.findById(handoffId);
    if (!handoff || handoff.sessionId !== sessionId) {
      throw new NotFoundException('Handoff não encontrado');
    }
    if (handoff.status !== 'offered') {
      throw new BadRequestException(
        `Handoff não está "offered" (está "${handoff.status}")`,
      );
    }

    const accepted = await this.handoffs.updateStatus(handoffId, 'accepted');

    await this.appendEvent.execute(projectId, sessionId, {
      type: 'handoff.accepted',
      actor: { kind: 'user', id: userId },
      payload: { handoffId, toAgent: handoff.toAgent },
    });

    // Agora a regra de ativação passa (handoff accepted p/ toAgent).
    await this.activateAgent.execute(
      projectId,
      sessionId,
      handoff.toAgent,
      userId,
    );

    return accepted;
  }
}
