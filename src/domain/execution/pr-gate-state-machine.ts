// Máquina de estados do gate de PR (Fase 4a): awaiting_qa → awaiting_secops →
// awaiting_user. Cada gate (QA/SecOps) só age sobre o SEU status — QA jamais
// decide sobre awaiting_secops e vice-versa — e só pode devolver pro MESMO
// gate em caso de reprovação (changes_requested), corrigido pelo dev na
// mesma branch, até um teto de correções — estourou, o CHAMADOR (não esta
// função) marca a task `blocked` (ver RecordGateVerdictUseCase). Puro, sem
// IO — espelha action-state-machine.ts/story-state-machine.ts.

export const PR_GATE_STATUSES = [
  'awaiting_qa',
  'awaiting_secops',
  'awaiting_user',
] as const;

export type PrGateStatus = (typeof PR_GATE_STATUSES)[number];

export type GateName = 'qa' | 'secops';
export type GateVerdict = 'approved' | 'changes_requested';

type ActiveGateStatus = Exclude<PrGateStatus, 'awaiting_user'>;

// Ordem IMUTÁVEL: aprovar QA avança pra awaiting_secops, nunca pula direto
// pra awaiting_user.
const GATE_FOR_STATUS: Record<ActiveGateStatus, GateName> = {
  awaiting_qa: 'qa',
  awaiting_secops: 'secops',
};

const NEXT_STATUS_ON_APPROVAL: Record<ActiveGateStatus, PrGateStatus> = {
  awaiting_qa: 'awaiting_secops',
  awaiting_secops: 'awaiting_user',
};

export class InvalidGateActionError extends Error {
  readonly gate: GateName;
  readonly status: PrGateStatus;

  constructor(gate: GateName, status: PrGateStatus) {
    super(`Gate "${gate}" não pode agir sobre o status "${status}"`);
    this.name = 'InvalidGateActionError';
    this.gate = gate;
    this.status = status;
  }
}

export interface GateTransitionResult {
  status: PrGateStatus | 'blocked';
  correctionCount: number;
}

/**
 * Aplica o parecer de um gate ao status atual. `approved` avança pro
 * próximo gate (contador de correção zera). `changes_requested` mantém o
 * MESMO gate incrementando o contador — estourou `maxCorrections`, devolve
 * `status: 'blocked'` (o chamador decide o que fazer com isso, ex.
 * `MarkTaskBlockedUseCase`). Lança `InvalidGateActionError` se o gate
 * chamado não é o dono do status atual (ex. SecOps tentando agir sobre
 * `awaiting_qa`) ou se o status já é terminal (`awaiting_user`).
 */
export function nextGateStatus(
  current: PrGateStatus,
  gate: GateName,
  verdict: GateVerdict,
  correctionCount: number,
  maxCorrections: number,
): GateTransitionResult {
  if (current === 'awaiting_user' || GATE_FOR_STATUS[current] !== gate) {
    throw new InvalidGateActionError(gate, current);
  }

  if (verdict === 'approved') {
    return { status: NEXT_STATUS_ON_APPROVAL[current], correctionCount: 0 };
  }

  const nextCount = correctionCount + 1;
  if (nextCount > maxCorrections) {
    return { status: 'blocked', correctionCount: nextCount };
  }
  return { status: current, correctionCount: nextCount };
}
