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
  /**
   * Predicado de membro, para a área cujos membros NÃO são enumeráveis.
   *
   * Só a área de `dev` usa: os membros dela são um por módulo do `module_map`,
   * decididos pelo Arquiteto e diferentes em cada projeto. Enumerar aqui seria
   * inventar nomes de módulo que este arquivo não tem como saber.
   */
  ehMembro?: (agentId: string) => boolean;
}

/**
 * Um dev agent de módulo: `dev-<modulo>` e o extra `dev-<modulo>-2`
 * (`devAgentId`/`extraDevAgentId` em `activate-execution.use-case.ts`).
 *
 * Prefixo PURO, de propósito. `dev-lead` também casa aqui, e quem o exclui é
 * `ehMembroDe` — "o lead não é membro da própria área" vale para qualquer
 * área, não só para dev, e duplicar a exclusão aqui deixava as duas cópias
 * inalcançáveis por teste (a mutação de uma sobrevivia à outra).
 */
export function ehDevDeModulo(agentId: string): boolean {
  return agentId.startsWith('dev-');
}

export const DEV_LEAD = 'dev-lead';

export const AGENT_AREAS: readonly AreaDeAgentes[] = [
  {
    // FASE 14d / ADR 0053 — a primeira área DINÂMICA. Os membros vivem em
    // `agent_areas`/`agent_area_members` por projeto; aqui só a REGRA de
    // endereçamento, que precisa valer sem consultar o banco a cada handoff.
    key: 'dev',
    label: 'Dev',
    lead: DEV_LEAD,
    members: [],
    ehMembro: ehDevDeModulo,
  },
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
  return (
    AGENT_AREAS.find((area) => area.lead === agentId) ??
    AGENT_AREAS.find((area) => ehMembroDe(area, agentId))
  );
}

/**
 * O agente é membro DESTA área?
 *
 * O lead nunca é membro da própria área, e a regra mora AQUI e só aqui. A
 * primeira versão repetia essa guarda em `areaDo` e em
 * `assertHandoffTargetAllowed`, e a mutação mostrou que nenhuma das cópias
 * era alcançável por teste: o predicado de `dev` já excluía o lead sozinho.
 * Guarda que nenhum teste consegue derrubar é guarda que apodrece.
 */
function ehMembroDe(area: AreaDeAgentes, agentId: string): boolean {
  if (area.lead === agentId) return false;
  if (area.members.includes(agentId)) return true;
  return area.ehMembro ? area.ehMembro(agentId) : false;
}

/** `true` quando o agente é subagente de uma área (membro, não lead). */
export function ehSubagente(agentId: string): boolean {
  return AGENT_AREAS.some((area) => ehMembroDe(area, agentId));
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
  const area = AGENT_AREAS.find((a) => ehMembroDe(a, toAgent));
  if (area) throw new HandoffToSubagentError(toAgent, area);
}
