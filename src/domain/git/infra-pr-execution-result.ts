// Resultado da execução de uma ação `open_infra_pr` (Fase 4a — InfraAgent):
// branch + commit dos artefatos de infra (N arquivos) + PR real aberta no
// provider. Guardado em proposed_actions.execution_result; a UI linka pra
// `pullRequestUrl`. Espelha `AdrPrExecutionResult`, mas `paths` é uma lista
// (uma PR de infra normalmente commita vários arquivos — Dockerfile por
// módulo, compose, esqueleto de CI — num único commit).
export interface InfraPrExecutionResult {
  pullRequestUrl: string;
  pullRequestId: string;
  branch: string;
  paths: string[];
  title: string;
}
