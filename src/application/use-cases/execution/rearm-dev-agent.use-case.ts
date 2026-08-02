import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * Rearma um dev agent travado pelo circuit breaker (Fase 12b — RN-047): um
 * clique do usuário, a única saída de `idle_tripped`. Zera o contador de
 * blocked consecutivas e devolve o agente a tentar reivindicar.
 */
@Injectable()
export class RearmDevAgentUseCase {
  constructor(
    private readonly engineClient: ApiToEngineClient,
    private readonly appendEvent: AppendSessionEventUseCase,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    agentId: string,
    userId: string,
  ) {
    // O engine vem PRIMEIRO (mesmo motivo do aceite de paralelização): o
    // event log é imutável, e registrar antes deixaria no feed um "rearmado"
    // que nunca aconteceu se o engine recusar (agente inexistente).
    await this.engineClient.rearmDevAgent(projectId, sessionId, agentId);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'dev.rearmed',
      actor: { kind: 'user', id: userId },
      payload: { agentId },
    });
    return { ok: true as const };
  }
}
