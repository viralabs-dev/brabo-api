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

export type GitActionExecutionResult =
  | GitCommitExecutionResult
  | GitPushExecutionResult
  | PrOpenExecutionResult
  | GitMergeExecutionResult;
