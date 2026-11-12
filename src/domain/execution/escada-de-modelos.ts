/**
 * RN-1142 (AT-916): a ESCADA de modelos do projeto — os degraus, do menor ao
 * maior, cada um com o teto de gasto por tarefa que vale enquanto o agente
 * está nele. O padrão é Haiku 5.5 → Sonnet 5 (decisão do dono, 11/11/2026).
 */
export interface DegrauDaEscada {
  modelId: string;
  /** Teto por tarefa (micro-USD) FIXO do degrau — nunca multiplicador. */
  taskBudgetMicros: number;
}

export interface EscadaDeModelos {
  ladder: DegrauDaEscada[];
}

/** N: bloqueios por limite de iterações, na MESMA tarefa, até subir um degrau. */
export const BLOQUEIOS_POR_LIMITE_ATE_ESCALAR = 2;

export const ESCADA_PADRAO: EscadaDeModelos = {
  ladder: [
    { modelId: 'claude-haiku-5-5', taskBudgetMicros: 500_000 },
    { modelId: 'claude-sonnet-5', taskBudgetMicros: 2_000_000 },
  ],
};

/** Origem `modelo` + a frase que o engine grava no teto de iterações. */
export function ehBloqueioPorLimiteDeIteracoes(
  reason: string,
  origin?: string | null,
): boolean {
  return origin === 'modelo' && reason.startsWith('limite de iterações');
}
