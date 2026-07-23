// Máquina de estados de ação proposta:
//   proposed → approved | rejected
//   auto_approved é terminal, atingido só na criação da linha (decisão
//   automática pela política do projeto) — nunca via transição, o que é
//   garantido estruturalmente por nunca aparecer como destino no mapa
//   abaixo.
//
// Puro e sem dependências de framework — testável isoladamente, sem
// precisar de banco nem de um TestingModule do Nest.

export const ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'auto_approved',
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
  proposed: ['approved', 'rejected'],
  approved: [],
  rejected: [],
  auto_approved: [],
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
  return status !== 'proposed';
}
