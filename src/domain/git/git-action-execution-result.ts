// Resultados de execução das ações git dos dev agents (Fase 4a). Guardados em
// proposed_actions.execution_result.

export interface GitCommitExecutionResult {
  kind: 'git_commit';
  sha: string;
  branch: string;
}

export interface GitPushExecutionResult {
  kind: 'git_push';
  branch: string;
}

export interface PrOpenExecutionResult {
  kind: 'pr_open';
  pullRequestUrl: string;
  pullRequestId: string;
  sourceBranch: string;
  targetBranch: string;
}

export interface GitMergeExecutionResult {
  kind: 'git_merge';
  pullRequestId: string;
  state: string;
  targetBranch: string;
}

/**
 * Resultado de uma ação git que FALHOU (RN-705). O `kind` é o tipo da AÇÃO —
 * antes toda falha gravava `{kind: 'git_push', branch: ''}`, inclusive a de
 * `git_merge`. `conflictingFiles` só existe no conflito de merge
 * (`GitMergeConflictError`), e é o que a aba PRs mostra.
 */
export interface GitActionFailureResult {
  kind: 'git_commit' | 'git_push' | 'pr_open' | 'git_merge';
  failed: true;
  error: string;
  pullRequestId?: string;
  conflictingFiles?: string[];
}

export type GitActionExecutionResult =
  | GitActionFailureResult
  | GitCommitExecutionResult
  | GitPushExecutionResult
  | PrOpenExecutionResult
  | GitMergeExecutionResult;
