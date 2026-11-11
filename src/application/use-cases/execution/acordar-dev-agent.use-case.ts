import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';

/**
 * "Procurar tarefa de novo" no cartão do dev agent ocioso (AT-906, RN-NOVA-2).
 * O engine vem PRIMEIRO, como no rearm: o log é imutável, e registrar antes
 * deixaria um `dev.wake_requested` de um pedido que o engine recusou (409, o
 * agente não está ocioso — o `ConflictException` sobe com a frase dele).
 */
@Injectable()
export class AcordarDevAgentUseCase {
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
    await this.engineClient.acordarDevAgent(projectId, sessionId, agentId);
    await this.appendEvent.execute(projectId, sessionId, {
      type: 'dev.wake_requested',
      actor: { kind: 'user', id: userId },
      payload: { agentId },
    });
    return { ok: true as const };
  }
}
