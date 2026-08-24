import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateHandoffUseCase } from './create-handoff.use-case';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { addressableAgents } from '../../../domain/agents/agent-areas';

/**
 * Handoff manual a agente à escolha (backlog, ADR 0109/RN-440): o usuário
 * endereça, pela tela da sessão, um handoff a QUALQUER agente endereçável —
 * não só o próximo da cadeia fixa (Criativo→PO→Arquiteto→Dev Lead…). O
 * caso de exercício real é o Staff (ADR 0088): código pronto desde a Fase
 * anterior, mas só alcançável pela rota interna do engine — nenhuma tela
 * deixava um humano oferecer o handoff a ele.
 *
 * Reusa `CreateHandoffUseCase` para a ESCRITA — é o ÚNICO lugar do sistema
 * que grava `toAgent` (ADR 0038) — e só resolve `fromAgent`/valida o alvo
 * aqui. A validação é mais ESTRITA que `assertHandoffTargetAllowed` (que só
 * recusa subagente de área): aqui o alvo tem de estar no catálogo FECHADO
 * de `addressableAgents()`, porque é um HUMANO escolhendo de uma lista, não
 * um agente citando outro que ele já conhece — um typo como "abc" também é
 * recusado, não só um subagente.
 */
@Injectable()
export class RequestManualHandoffUseCase {
  constructor(
    private readonly createHandoff: CreateHandoffUseCase,
    private readonly events: SessionEventRepository,
  ) {}

  async execute(
    projectId: string,
    sessionId: string,
    toAgent: string,
    userId: string,
  ) {
    if (!addressableAgents().includes(toAgent)) {
      throw new BadRequestException(
        `"${toAgent}" não é um agente endereçável por handoff manual`,
      );
    }

    // `fromAgent` documenta de QUE conversa o handoff partiu — o agente
    // ATIVO mais recente da sessão, mesmo critério de `activeAgent` em
    // `SessionPage.tsx` (o último `agent.activated`, por `seq`). Sessão sem
    // NENHUM agente ativado ainda usa o sentinela "usuario": não existe
    // agente de origem nenhum, e inventar um mentiria sobre a origem —
    // mesma régua da RN-059 (nunca diagnóstico por eliminação).
    const activations = await this.events.listByTypeInSession(
      sessionId,
      'agent.activated',
    );
    const last = activations[activations.length - 1];
    const fromAgent =
      (last?.payload as { agent?: string } | undefined)?.agent ?? 'usuario';

    return this.createHandoff.execute(projectId, sessionId, {
      fromAgent,
      toAgent,
      actor: { kind: 'user', id: userId },
    });
  }
}
