/**
 * Lançado pelo `ApiToEngineClient` (implementação HTTP) quando o engine
 * recusa uma rodada da Anamnese porque a flag global `ANAMNESE_ENABLED` está
 * desligada — decisão de PRODUTO do usuário em 2026-08-10 ("hoje ele não
 * está trazendo dados de muito valor"), documentada em
 * docs/explanation/backlog.md, não bug.
 *
 * `RunAnamneseUseCase` converte isto numa resposta HTTP distinta de
 * "projeto sem sessão" (409) — os dois eram fáceis de confundir num 409
 * puro, e a web precisa mostrar mensagens diferentes para cada um.
 */
export class AnamneseDisabledError extends Error {
  constructor() {
    super('A Anamnese está desativada globalmente');
    this.name = 'AnamneseDisabledError';
  }
}
