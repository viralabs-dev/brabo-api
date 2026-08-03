/**
 * Áreas de agentes (ADR 0038) do lado da api.
 *
 * ## Por que é uma lista fixa, e não uma tabela
 *
 * O aparato genérico do ADR 0038 — `agent_areas`/`agent_area_members`, área
 * configurável por projeto, orçamento por área — é **corte de escopo
 * registrado** da Fase 8, e continua cortado (`db/schema.ts`, comentário da
 * tabela `delegations`). Área, lead e membros são fatos do produto, hardcoded
 * em `apps/web/src/lib/agents.ts` e no engine.
 *
 * O que faltava não era a tabela: era a REGRA. O ADR 0038 mandou
 * `CreateHandoffUseCase` recusar handoff endereçado a subagente, e essa
 * validação nunca foi implementada — achado #12 do primeiro dogfooding. Isto
 * aqui é a terceira cópia da mesma lista, e existe porque a regra precisa
 * viver do lado que grava `handoffs`. A cópia é travada por teste contra a do
 * web (`test/domain/agents/agent-areas.spec.ts`): divergir reprova.
 */
export interface AreaDeAgentes {
  key: string;
  label: string;
  lead: string;
  members: readonly string[];
}

export const AGENT_AREAS: readonly AreaDeAgentes[] = [
  {
    key: 'qa',
    label: 'QA',
    lead: 'qa',
    members: ['qa-automacao', 'qa-performance-seguranca'],
  },
  {
    key: 'infra',
    label: 'Infra',
    lead: 'infra',
    members: ['infra-workflows'],
  },
];

/** Área do agente, se houver — como LEAD ou como membro. */
export function areaDo(agentId: string): AreaDeAgentes | undefined {
  return AGENT_AREAS.find(
    (area) => area.lead === agentId || area.members.includes(agentId),
  );
}

/** `true` quando o agente é subagente de uma área (membro, não lead). */
export function ehSubagente(agentId: string): boolean {
  return AGENT_AREAS.some((area) => area.members.includes(agentId));
}

/**
 * Handoff EXTERNO endereça só lead de área ou agente sem área — a regra do
 * ADR 0038. Delegação interna (lead → subagente) é privada da área e não passa
 * por aqui: ela tem tabela própria (`delegations`) e caminho próprio
 * (`RecordDelegationUseCase`).
 */
export class HandoffToSubagentError extends Error {
  constructor(
    readonly toAgent: string,
    readonly area: AreaDeAgentes,
  ) {
    super(
      `handoff não pode endereçar o subagente "${toAgent}": ` +
        `quem fala com a área ${area.label} de fora é o lead "${area.lead}". ` +
        `Delegação interna é decisão dele, não do chamador.`,
    );
    this.name = 'HandoffToSubagentError';
  }
}

export function assertHandoffTargetAllowed(toAgent: string): void {
  const area = AGENT_AREAS.find((a) => a.members.includes(toAgent));
  if (area) throw new HandoffToSubagentError(toAgent, area);
}
