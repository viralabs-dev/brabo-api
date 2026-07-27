import { Injectable } from '@nestjs/common';
import {
  TokenUsageRepository,
  type AgentTokenUsage,
} from '../../ports/token-usage-repository.port';

/**
 * Custo por AGENTE numa sessão (Fase 4a — painel do time).
 *
 * O painel precisa mostrar "tokens da sessão" em cada AgentCard, e até aqui o
 * único número por agente disponível na web era o `tokensSpentMicros` do
 * último `agent.response` — que é o acumulado do ToolLoop CORRENTE (some
 * quando o agente começa outra task) e só existe pros agentes que rodam
 * ToolLoop. Os conversacionais não tinham número nenhum. Ver ADR 0021.
 *
 * Lê de `token_usage`, que já é gravado incondicionalmente por
 * `RecordLlmUsageUseCase` pra QUALQUER agente — nenhuma instrumentação nova.
 */
@Injectable()
export class GetSessionTokenUsageUseCase {
  constructor(private readonly tokenUsage: TokenUsageRepository) {}

  execute(sessionId: string): Promise<AgentTokenUsage[]> {
    return this.tokenUsage.sumBySessionGroupedByActor(sessionId);
  }
}
