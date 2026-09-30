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
  // Estados terminais: nenhuma transição GENÉRICA sai deles. A única saída é
  // a REABERTURA (ADR 0183, RN-649), que tem caminho próprio — `assertReopen`
  // abaixo — e rota própria, com papel próprio. Pôr `active` aqui abriria a
  // reabertura pela rota genérica de transição, com o papel dela (`developer`)
  // e sem o evento `session.reopened`.
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

/**
 * A reabertura (ADR 0183, RN-649): a ÚNICA transição que sai de um estado
 * terminal, e só para `active`. É separada de `canTransition` de propósito —
 * a rota genérica de transição continua recusando `closed → active` com 409,
 * e `closing → active` continua proibido por qualquer caminho (a adoção no
 * drain de shutdown depende disso, `shutdown.ex`).
 */
export function canReopen(from: SessionStatus): boolean {
  return isTerminal(from);
}

export function assertReopen(from: SessionStatus): void {
  if (!canReopen(from)) {
    throw new InvalidSessionTransitionError(from, 'active');
  }
}
