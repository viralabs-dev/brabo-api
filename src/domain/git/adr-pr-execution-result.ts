// Resultado da execução de uma ação `open_adr_pr` (Fase 3b — Arquiteto):
// branch + commit do ADR + PR real aberta no provider. Guardado em
// proposed_actions.execution_result; a UI linka pra `pullRequestUrl`.
export interface AdrPrExecutionResult {
  pullRequestUrl: string;
  pullRequestId: string;
  branch: string;
  path: string;
  title: string;
}
