import type { DelegationStatus } from './delegation.entity';
import type { FailureOrigin } from './failure-origin';

// Espelha as três constraints do banco (`delegations_completed_tem_parecer`,
// `_failed_tem_origem`, `_dispensed_tem_justificativa`) — de propósito, não
// duplicação acidental: o banco é a garantia ÚLTIMA (sobrevive a um bug
// nesta função), esta checagem é o que dá 400 legível em vez de estourar a
// constraint como erro 500 de SQL.
export class DelegationPayloadInvalidoError extends Error {
  readonly status: DelegationStatus;

  constructor(status: DelegationStatus, campoFaltando: string) {
    super(
      `Delegação "${status}" exige "${campoFaltando}", e ele não veio no payload.`,
    );
    this.name = 'DelegationPayloadInvalidoError';
    this.status = status;
  }
}

export interface DelegationOutcomeInput {
  status: DelegationStatus;
  parecerArtifactId?: string | null;
  failureOrigin?: FailureOrigin | null;
  justification?: string | null;
}

export function assertDelegationOutcomeWellFormed(
  input: DelegationOutcomeInput,
): void {
  if (input.status === 'completed' && !input.parecerArtifactId) {
    throw new DelegationPayloadInvalidoError('completed', 'parecerArtifactId');
  }
  if (input.status === 'failed' && !input.failureOrigin) {
    throw new DelegationPayloadInvalidoError('failed', 'failureOrigin');
  }
  if (input.status === 'dispensed' && !input.justification) {
    throw new DelegationPayloadInvalidoError('dispensed', 'justification');
  }
}
