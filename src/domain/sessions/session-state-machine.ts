// Máquina de estados de sessão (CLAUDE.md):
//   created → active → closing → closed | closed_abnormally
//
// Puro e sem dependências de framework — testável isoladamente, sem
// precisar de banco nem de um TestingModule do Nest.

export const SESSION_STATUSES = [
  'created',
  'active',
  'closing',
  'closed',
  'closed_abnormally',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export class InvalidSessionTransitionError extends Error {
  readonly from: SessionStatus;
  readonly to: SessionStatus;

  constructor(from: SessionStatus, to: SessionStatus) {
    super(`Transição de sessão inválida: "${from}" -> "${to}"`);
    this.name = 'InvalidSessionTransitionError';
    this.from = from;
    this.to = to;
  }
}

const ALLOWED_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  // Pode ativar normalmente, ou morrer antes de ativar (ex.: falha de provisionamento).
  created: ['active', 'closed_abnormally'],
  // Fluxo feliz segue para closing; pode também morrer abruptamente.
  active: ['closing', 'closed_abnormally'],
  // De closing só se sai fechando (normal ou abrupto) — nunca de volta a active.
  closing: ['closed', 'closed_abnormally'],
  // Estados terminais: nenhuma transição sai deles.
  closed: [],
  closed_abnormally: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidSessionTransitionError(from, to);
  }
}

export function isTerminal(status: SessionStatus): boolean {
  return status === 'closed' || status === 'closed_abnormally';
}
