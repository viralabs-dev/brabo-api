import { Injectable } from '@nestjs/common';
import { ApiToEngineClient } from '../../ports/api-to-engine-client.port';

/**
 * O botão "Parar" do composer (RN-122). Diferente de `SendAgentMessageUseCase`,
 * não grava `chat.message` nenhum — cancelar não é uma fala do usuário, e o
 * desfecho de verdade (o `agent.error` com origem "politica" e o motivo do
 * cancelamento) quem grava é o PRÓPRIO engine, no evento terminal do turno que
 * ele matou.
 *
 * Idempotente por construção: sem turno em curso (ou sem o agente de pé), o
 * engine trata o cancelamento como NO-OP — esta rota nunca falha por "não
 * havia o quê cancelar".
 */
@Injectable()
export class CancelAgentTurnUseCase {
  constructor(private readonly engineClient: ApiToEngineClient) {}

  async execute(projectId: string, sessionId: string, agent: string) {
    await this.engineClient.cancelAgentTurn(projectId, sessionId, agent);

    return { ok: true as const };
  }
}
