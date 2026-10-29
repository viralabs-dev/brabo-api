/**
 * Lançado pelo `ApiToEngineClient` quando o engine recusa retomar o turno de um
 * agente (AT-582, ADR 0226) — `ResumeAgentTurnUseCase` o converte em 409 com o
 * `reason` que o engine nomeou (`turno_nao_interrompido`, `agente_sem_retomada`).
 */
export class TurnoNaoRetomavelError extends Error {
  constructor(readonly reason: string) {
    super(`O engine recusou retomar o turno: ${reason}`);
    this.name = 'TurnoNaoRetomavelError';
  }
}
