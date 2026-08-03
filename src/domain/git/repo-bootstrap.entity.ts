// Cursor de progresso do bootstrap de Gitflow — uma linha por projeto,
// não um log por passo (ver docs/adr/0005-repo-bootstrap-idempotent-steps.md).
// `step` é o último passo tocado; toda execução do runner revalida TODOS
// os passos desde o início antes de confiar nesse cursor.
//
// Esta lista é o VOCABULÁRIO da coluna `repo_bootstraps.step` — tudo que ela
// pode conter, em ordem histórica de execução. Não é a lista do que o
// bootstrap faz hoje: essa é BOOTSTRAP_STEP_SEQUENCE, em
// application/use-cases/git/bootstrap-steps.ts, e ela é MENOR (ver
// RETIRED_BOOTSTRAP_STEPS abaixo).
//
// Os dois commits em `main` vêm ANTES das branches, não depois: `createRepo`
// não faz commit inicial em nenhum provider (auto_init: false), então uma ref
// sem commit nenhum não pode ser origem de `createBranch`.
// `deriveProvisioningStatus` (repo-bootstrap-status.ts) usa o ÚLTIMO valor
// deste array pra saber quando o bootstrap convergiu — `protect_branches`
// fecha a lista, e é isso que precisa continuar verdadeiro.

export const BOOTSTRAP_STEPS = [
  'commit_pr_template',
  'commit_branching_policy',
  'create_dev_branch',
  'create_qa_branch',
  'create_rc_branch',
  'protect_branches',
] as const;

export type BootstrapStepName = (typeof BOOTSTRAP_STEPS)[number];

/**
 * Passos APOSENTADOS: continuam no vocabulário (e no enum `bootstrap_step` do
 * banco), mas o bootstrap não os executa mais.
 *
 * `create_rc_branch` saiu quando o degrau `rc` saiu da política (ADR 0030): o
 * bootstrap continuava criando e protegendo a branch, e o
 * `branching-policy.md` que ele commita no repositório do usuário continuava
 * ensinando a escada de quatro — achado #3 do primeiro dogfooding.
 *
 * Ele NÃO sai do vocabulário, e por dois motivos distintos: bootstraps já
 * rodados têm linhas com esse valor (apagá-lo reescreveria história para negar
 * um passo que aconteceu), e a api pode devolvê-lo — um contrato que só
 * publicasse os passos atuais mentiria sobre um projeto antigo.
 *
 * Quem consome isto é a UI, para não listar como pendente um passo que nunca
 * vai rodar (ver `apps/web/src/lib/bootstrap.ts`).
 */
export const RETIRED_BOOTSTRAP_STEPS: readonly BootstrapStepName[] = [
  'create_rc_branch',
];

export const BOOTSTRAP_STATUSES = [
  'pending',
  'running',
  'done',
  'failed',
] as const;

export type BootstrapStepStatus = (typeof BOOTSTRAP_STATUSES)[number];

// --- Adoção (Fase 12a) ---

export const REPO_ORIGINS = ['created', 'adopted'] as const;

/** O Brabo criou o repositório, ou apontou pra um que já existia (RN-046). */
export type RepoOrigin = (typeof REPO_ORIGINS)[number];

export const BOOTSTRAP_PLAN_DECISIONS = ['approved', 'as_is'] as const;

/**
 * `approved` = roda o bootstrap; `as_is` = adota sem bootstrap nenhum.
 * A AUSÊNCIA (null) é o estado que importa: plano gerado e não decidido,
 * onde nada roda (RN-045).
 */
export type BootstrapPlanDecision = (typeof BOOTSTRAP_PLAN_DECISIONS)[number];

/** Uma mutação que o bootstrap FARIA — serializada de `check()`, nunca executada. */
export interface BootstrapPlanStep {
  step: BootstrapStepName;
  actionType: string;
  payload: Record<string, unknown>;
}

export const BOOTSTRAP_DIAGNOSTIC_KINDS = [
  'missing_branch',
  'unprotected_branch',
  'missing_file',
  'extra_branch',
  'capability_unsupported',
] as const;

export type BootstrapDiagnosticKind =
  (typeof BOOTSTRAP_DIAGNOSTIC_KINDS)[number];

/**
 * O que o repositório tem de diferente do template. `extra_branch` é
 * INFORMATIVO e nunca vira passo — política própria do projeto é achado,
 * não erro (Fase 12a).
 */
export interface BootstrapDiagnostic {
  kind: BootstrapDiagnosticKind;
  detail: Record<string, unknown>;
}

export interface BootstrapPlan {
  generatedAt: string;
  steps: BootstrapPlanStep[];
  diagnostics: BootstrapDiagnostic[];
}

export interface RepoBootstrap {
  id: string;
  projectId: string;
  sessionId: string;
  step: BootstrapStepName;
  status: BootstrapStepStatus;
  attempts: number;
  lastError: string | null;
  origin: RepoOrigin;
  plan: BootstrapPlan | null;
  planGeneratedAt: Date | null;
  planDecision: BootstrapPlanDecision | null;
  planDecidedAt: Date | null;
  planDecidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
