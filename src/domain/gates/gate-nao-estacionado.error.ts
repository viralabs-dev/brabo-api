/**
 * Lançado pelo `ApiToEngineClient` quando o engine recusa retomar um ciclo de
 * gate que não está ESTACIONADO (ADR 0207, RN-724) — `ResumeParkedGateUseCase`
 * o converte em 409 `gate_nao_estacionado`.
 */
export class GateNaoEstacionadoError extends Error {
  constructor() {
    super('O ciclo do gate não está estacionado');
    this.name = 'GateNaoEstacionadoError';
  }
}
