// Cursor de progresso do bootstrap de Gitflow — uma linha por projeto,
// não um log por passo (ver docs/adr/0005-repo-bootstrap-idempotent-steps.md).
// `step` é o último passo tocado; toda execução do runner revalida TODOS
// os passos desde o início antes de confiar nesse cursor.
//
// ORDEM AQUI = ordem de EXECUÇÃO real (BOOTSTRAP_STEP_SEQUENCE em
// application/use-cases/git/bootstrap-steps.ts) — os dois commits em
// `main` vêm ANTES das branches, não depois: `createRepo` não faz commit
// inicial em nenhum provider (auto_init: false), então uma ref sem commit
// nenhum não pode ser origem de `createBranch`. `deriveProvisioningStatus`
// (repo-bootstrap-status.ts) usa o ÚLTIMO valor deste array pra saber
// quando o bootstrap convergiu — se as duas ordens divergirem, "já
// convergiu" fica errado.

export const BOOTSTRAP_STEPS = [
  'commit_pr_template',
  'commit_branching_policy',
  'create_dev_branch',
  'create_qa_branch',
  'create_rc_branch',
  'protect_branches',
] as const;

export type BootstrapStepName = (typeof BOOTSTRAP_STEPS)[number];

export const BOOTSTRAP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
] as const;

export type BootstrapStepStatus = (typeof BOOTSTRAP_STATUSES)[number];

export interface RepoBootstrap {
  id: string;
  projectId: string;
  sessionId: string;
  step: BootstrapStepName;
  status: BootstrapStepStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}
