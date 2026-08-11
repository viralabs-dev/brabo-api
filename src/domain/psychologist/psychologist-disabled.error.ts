/**
 * Lançado pelo `ApiToEngineClient` (implementação HTTP) quando o engine
 * recusa uma reanálise porque a flag global `PSYCHOLOGIST_ENABLED` está
 * desligada — decisão de PRODUTO do usuário em 2026-08-10, mesmo padrão já
 * aplicado à Anamnese (`AnamneseDisabledError`, "hoje ele não está trazendo
 * dados de muito valor"), documentada em docs/explanation/backlog.md, não
 * bug.
 *
 * `ReanalyzeSessionUseCase` converte isto numa `ServiceUnavailableException`
 * (503) — nunca um 500 genérico.
 */
export class PsychologistDisabledError extends Error {
  constructor() {
    super('O Psicólogo está desativado globalmente');
    this.name = 'PsychologistDisabledError';
  }
}
