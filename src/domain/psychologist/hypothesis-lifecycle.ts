// Ciclo de vida da hipótese do Psicólogo (Fase 4b): proposed -> accepted |
// dismissed, decidido pelo usuário na UI. Puro, sem IO — espelha
// action-state-machine.ts/pr-gate-state-machine.ts, mas sem contador de
// correção (não há "devolução" de hipótese, só uma decisão terminal).

export const HYPOTHESIS_STATUSES = [
  'proposed',
  'accepted',
  'dismissed',
] as const;

export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];

export class InvalidHypothesisTransitionError extends Error {
  readonly from: HypothesisStatus;
  readonly to: HypothesisStatus;

  constructor(from: HypothesisStatus, to: HypothesisStatus) {
    super(`Hipótese "${from}" não pode transicionar para "${to}"`);
    this.name = 'InvalidHypothesisTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Só `proposed -> accepted` e `proposed -> dismissed` são legais — uma
 * hipótese já decidida (accepted/dismissed) é terminal, nunca re-decidida
 * (evita corrida de double-accept/double-dismiss na UI).
 */
export function assertHypothesisTransition(
  current: HypothesisStatus,
  to: Extract<HypothesisStatus, 'accepted' | 'dismissed'>,
): void {
  if (current !== 'proposed') {
    throw new InvalidHypothesisTransitionError(current, to);
  }
}
