// Regra de ativação de agentes numa sessão (Fase 3b, CLAUDE.md 3b.5):
//   "um agente só pode ser ativado numa sessão com handoff `accepted`
//    endereçado a ele (exceção única: Criativo, que inicia por comando do
//    usuário)."
//
// Puro e sem dependências de framework — recebe os handoffs JÁ carregados e
// decide; nenhum IO aqui (espelha domain/actions/decide.ts e a máquina de
// estados de sessão). O IO (buscar handoffs, subir o processo do agente) fica
// no use-case.

export type HandoffStatus = 'offered' | 'accepted' | 'completed' | 'rejected';

// Só o que a regra precisa de um handoff — não o registro inteiro.
export interface HandoffView {
  toAgent: string;
  status: HandoffStatus;
}

// Agentes que iniciam por comando direto do usuário, sem handoff recebido.
// Hoje só o Criativo (topo do fluxo de ideação); os demais (PO, Arquiteto…)
// só entram por handoff `accepted`.
export const USER_STARTED_AGENTS = ['criativo'] as const;

export function isUserStartedAgent(agent: string): boolean {
  return (USER_STARTED_AGENTS as readonly string[]).includes(agent);
}

export class AgentActivationBlockedError extends Error {
  readonly agent: string;

  constructor(agent: string) {
    super(
      `Agente "${agent}" não pode ser ativado: nenhum handoff aceito endereçado a ele`,
    );
    this.name = 'AgentActivationBlockedError';
    this.agent = agent;
  }
}

export function canActivateAgent(
  agent: string,
  handoffs: readonly HandoffView[],
): boolean {
  if (isUserStartedAgent(agent)) {
    return true;
  }
  return handoffs.some((h) => h.toAgent === agent && h.status === 'accepted');
}

export function assertCanActivate(
  agent: string,
  handoffs: readonly HandoffView[],
): void {
  if (!canActivateAgent(agent, handoffs)) {
    throw new AgentActivationBlockedError(agent);
  }
}
