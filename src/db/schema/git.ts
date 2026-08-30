// Git providers (Fase 2): conexão OAuth, repositório provisionado e o cursor
// idempotente do bootstrap de Gitflow — `domain/git`.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { projects, users } from './iam';
import { sessions } from './sessions';

// Cursor de progresso do bootstrap de Gitflow (Fase 2, sessão 3) — uma
// linha por projeto, não um log por passo. `step` é o último passo
// tocado; toda execução revalida TODOS os passos desde o início antes de
// confiar nesse cursor (ver docs/adr/0005).
export const bootstrapStepEnum = pgEnum('bootstrap_step', [
  'create_dev_branch',
  'create_qa_branch',
  'create_rc_branch',
  'protect_branches',
  'commit_pr_template',
  'commit_branching_policy',
]);

export const bootstrapStatusEnum = pgEnum('bootstrap_status', [
  'pending',
  'running',
  'done',
  'failed',
]);

// De onde veio o repositório do projeto (Fase 12a, RN-046): o Brabo o
// CRIOU, ou apontou para um que já existia. A Fase 10 precisou inserir
// essas linhas à mão porque adoção não existia como operação — a origem
// é o que torna o caso adotado legítimo e rastreável em vez de um seed
// manual indistinguível de um provisionamento normal.
export const repoOriginEnum = pgEnum('repo_origin', ['created', 'adopted']);

// A decisão do usuário sobre o PLANO de bootstrap de um repo adotado
// (Fase 12a, RN-045). Nulo = plano gerado e ainda não decidido: nenhuma
// mutação roda nesse estado.
export const bootstrapPlanDecisionEnum = pgEnum('bootstrap_plan_decision', [
  'approved',
  'as_is',
]);

export const gitProviderEnum = pgEnum('git_provider', [
  'local',
  'github',
  'gitlab',
]);

// Só existe pra 'github'/'gitlab' — 'local' nunca tem linha aqui (não
// reforçado por constraint, pra não complicar o enum compartilhado com
// project_repositories). O envelope (mesmas 6 colunas de user_credentials,
// via EncryptionService) cifra um JSON {accessToken, refreshToken}, não
// uma string simples — GitLab emite refresh_token, GitHub OAuth App
// clássico normalmente não (fica null dentro do JSON).
export const projectGitConnections = pgTable(
  'project_git_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: gitProviderEnum('provider').notNull(),
    wrappedDek: text('wrapped_dek').notNull(),
    dekIv: text('dek_iv').notNull(),
    dekAuthTag: text('dek_auth_tag').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    apiKeyIv: text('api_key_iv').notNull(),
    apiKeyAuthTag: text('api_key_auth_tag').notNull(),
    // null = token não expira (GitHub OAuth App clássico).
    accessTokenExpiresAt: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    accountLogin: text('account_login'),
    accountMetadata: jsonb('account_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    connectedBy: uuid('connected_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.provider)],
);

// Tabela separada de project_git_connections: ciclo de vida diferente
// (uma conexão OAuth pode ser desconectada/reconectada sem apagar o fato
// histórico de que o projeto já teve um repo provisionado; 'local' nunca
// tem linha na tabela de conexão mas precisa de uma linha aqui).
export const projectRepositories = pgTable(
  'project_repositories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    provider: gitProviderEnum('provider').notNull(),
    // "owner/repo" (github), "namespace/path" (gitlab), path absoluto (local)
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    visibility: text('visibility').notNull(), // 'public' | 'private'
    // Fase 12a (RN-046): imutável depois de gravado. O default `created`
    // é também o backfill da migração 0031 — tudo que existia antes da
    // adoção existir foi, por definição, criado pelo Brabo.
    origin: repoOriginEnum('origin').notNull().default('created'),
    provisionedBy: uuid('provisioned_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId)],
);

// Progresso do bootstrap de Gitflow que roda depois de criar o repo
// (branches dev/qa/rc, proteções, template de PR, branching-policy.md) —
// tabela separada de project_repositories porque tem ciclo de vida e
// forma diferentes (cursor de retomada, não um fato histórico único).
// session_id aponta pra sessão dedicada (criada na 1ª tentativa, reusada
// em toda retomada) onde o bootstrap narra sua história via session_events
// — ver docs/adr/0005-repo-bootstrap-idempotent-steps.md.
export const repoBootstraps = pgTable(
  'repo_bootstraps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    step: bootstrapStepEnum('step').notNull().default('create_dev_branch'),
    status: bootstrapStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    // --- Adoção (Fase 12a) ---
    origin: repoOriginEnum('origin').notNull().default('created'),
    /**
     * SNAPSHOT do dry-run, não log: `{ generatedAt, steps[], diagnostics[] }`.
     * É a serialização do que `check()` devolveu — as mutações que o
     * bootstrap FARIA — sem nada ter sido executado. Fica na linha do
     * cursor porque tem o mesmo dono, a mesma chave e o mesmo tempo de
     * vida; o histórico já mora em `session_events` e `proposed_actions`,
     * e uma terceira narrativa daria a impressão errada de que planos
     * antigos são consultáveis.
     */
    plan: jsonb('plan'),
    planGeneratedAt: timestamp('plan_generated_at', { withTimezone: true }),
    /**
     * Nulo = plano gerado e ainda NÃO decidido. É o portão da RN-045:
     * enquanto for nulo, nenhuma mutação de bootstrap roda — o runner
     * simplesmente não é chamado. `as_is` guarda o plano de propósito,
     * como evidência do que deliberadamente não foi aplicado.
     */
    planDecision: bootstrapPlanDecisionEnum('plan_decision'),
    planDecidedAt: timestamp('plan_decided_at', { withTimezone: true }),
    planDecidedBy: uuid('plan_decided_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId)],
);
