// Ações git que TÊM executor (Fase 4a) — roteadas por Approve/Propose pro
// ExecuteGitActionUseCase. As demais git_* (bootstrap) auto-executam inline no
// provisionamento, fora deste caminho.
export const GIT_EXECUTED_ACTION_TYPES: readonly string[] = [
  'git_commit',
  'git_push',
  'pr_open',
  'git_merge',
];
