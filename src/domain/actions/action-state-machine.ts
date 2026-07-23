// Máquina de estados de ação proposta:
//   pending → approved | denied
//   approved | auto_approved → executed | failed
// "denied" cobre tanto recusa manual quanto deny automático da política
// (unificado — não há distinção de causa no estado, só em rejectionReason).
// auto_approved só é atingido na criação da linha (decisão automática) —
// nunca via transição, garantido estruturalmente por nunca aparecer como
// destino no mapa abaixo.
//
// Puro e sem dependências de framework — testável isoladamente, sem
// precisar de banco nem de um TestingModule do Nest.

export const ACTION_STATUSES = [
  'pending',
  'approved',
  'denied',
  'auto_approved',
  'executed',
  'failed',
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

export class InvalidActionTransitionError extends Error {
  readonly from: ActionStatus;
  readonly to: ActionStatus;

  constructor(from: ActionStatus, to: ActionStatus) {
    super(`Transição de ação inválida: "${from}" -> "${to}"`);
    this.name = 'InvalidActionTransitionError';
    this.from = from;
    this.to = to;
  }
}

const ALLOWED_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  pending: ['approved', 'denied'],
  approved: ['executed', 'failed'],
  denied: [],
  auto_approved: ['executed', 'failed'],
  executed: [],
  failed: [],
};

export function canTransition(from: ActionStatus, to: ActionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ActionStatus, to: ActionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidActionTransitionError(from, to);
  }
}

export function isTerminal(status: ActionStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}
