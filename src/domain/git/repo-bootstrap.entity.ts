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
  'protect_branches',
] as const;

/**
 * Passos que o bootstrap NÃO executa mais, mas que existem em linhas antigas
 * de `repo_bootstraps.step` e no enum `bootstrap_step` do banco.
 *
 * `create_rc_branch` saiu quando o degrau `rc` saiu da política (ADR 0030); o
 * bootstrap continuava criando e protegendo a branch, e o
 * `branching-policy.md` commitado no repositório do usuário continuava
 * ensinando a escada de quatro — achado #3 do primeiro dogfooding.
 *
 * O valor fica no enum de propósito: bootstraps já rodados têm linhas com ele,
 * e removê-lo reescreveria história para apagar um passo que realmente
 * aconteceu. Ele não entra em `BOOTSTRAP_STEPS` porque essa lista é a ORDEM DE
 * EXECUÇÃO — e é do último item dela que `deriveProvisioningStatus` tira "já
 * convergiu".
 */
export const RETIRED_BOOTSTRAP_STEPS = ['create_rc_branch'] as const;

export type BootstrapStepName =
  | (typeof BOOTSTRAP_STEPS)[number]
  | (typeof RETIRED_BOOTSTRAP_STEPS)[number];

/**
 * Todos os valores que `repo_bootstraps.step` PODE ter — os que o bootstrap
 * executa hoje mais os aposentados. É o que a api pode devolver, então é isto
 * que os DTOs declaram no OpenAPI: publicar só os atuais faria o contrato
 * mentir sobre um projeto antigo, cujo cursor legitimamente aponta para um
 * passo que não existe mais.
 */
export const ALL_BOOTSTRAP_STEP_NAMES = [
  ...BOOTSTRAP_STEPS,
  ...RETIRED_BOOTSTRAP_STEPS,
] as const;

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
