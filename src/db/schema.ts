import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  bigserial,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { PermissionsConfig } from '../domain/actions/permission-resolver';

// --- Enums ---

// Vocabulário de papel único, compartilhado entre workspace_members e
// project_members — o papel de projeto sobrepõe o de workspace (ver
// RolesService), então os dois precisam falar a mesma linguagem.
export const roleEnum = pgEnum('role', [
  'owner',
  'maintainer',
  'developer',
  'viewer',
]);

// created → active → closing → closed | closed_abnormally (CLAUDE.md)
export const sessionStatusEnum = pgEnum('session_status', [
  'created',
  'active',
  'closing',
  'closed',
  'closed_abnormally',
]);

export const actorKindEnum = pgEnum('actor_kind', ['user', 'agent', 'system']);

export const llmProviderEnum = pgEnum('llm_provider', [
  'ollama',
  'anthropic',
  'openai',
]);

// workspace < project < agent < session, do menos pro mais específico —
// ver domain/llm/binding-resolver.ts pra precedência de resolução.
export const modelBindingScopeEnum = pgEnum('model_binding_scope', [
  'workspace',
  'project',
  'agent',
  'session',
]);

export const budgetPolicyEnum = pgEnum('budget_policy', ['block', 'allow']);

export const actionStatusEnum = pgEnum('action_status', [
  'proposed',
  'approved',
  'rejected',
  'auto_approved',
]);

// Só a coluna resolved_policy usa enum de Postgres — é escalar. O mesmo
// vocabulário dentro de projects.permissions (jsonb) é um union type TS
// (domain/actions/permission-resolver.ts), não um enum de banco: Postgres
// não valida elementos de um jsonb.
export const permissionPolicyEnum = pgEnum('permission_policy', [
  'auto_approve',
  'require_approval',
  'deny',
]);

export const gitProviderEnum = pgEnum('git_provider', [
  'local',
  'github',
  'gitlab',
]);

// --- Identidade ---

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  keycloakSub: text('keycloak_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- IAM ---

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    permissions: jsonb('permissions')
      .$type<PermissionsConfig>()
      .notNull()
      .default({ rules: [] }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.workspaceId, table.slug)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

// --- Sessões ---

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  status: sessionStatusEnum('status').notNull().default('created'),
  // Contador da próxima seq a atribuir em session_events — incrementado
  // atomicamente via UPDATE (lock de linha) para garantir seq sem gaps
  // mesmo sob escrita concorrente. Ver SessionEventsService.append.
  nextSeq: integer('next_seq').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

// --- Event log (append-only) ---

export const sessionEvents = pgTable(
  'session_events',
  {
    id: text('id').primaryKey(), // ULID
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(),
    actorId: text('actor_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.sessionId, table.seq)],
);

// --- Transactional outbox (sem consumidor ainda) ---

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('outbox_events_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} is null`),
  ],
);

// --- LLM: registro de modelos, binding em cascata, credenciais, metering, budget ---

// Colunas monetárias em INTEIRO micro-USD (1 USD = 1_000_000 micros) —
// bigint({mode:'number'}) mapeia pra number do JS (seguro até 2^53),
// evitando a aritmética via string do tipo numeric do Postgres.
export const models = pgTable(
  'models',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: llmProviderEnum('provider').notNull(),
    name: text('name').notNull(), // id do modelo no provider, ex. "llama3.2:1b"
    displayName: text('display_name').notNull(),
    inputPricePerMillionMicros: bigint('input_price_per_million_micros', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    outputPricePerMillionMicros: bigint('output_price_per_million_micros', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    contextWindow: integer('context_window'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.provider, table.name)],
);

export const modelBindings = pgTable(
  'model_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: modelBindingScopeEnum('scope').notNull(),
    // Mesma convenção de session_events.actor_id: às vezes UUID
    // (workspace/project/session), às vezes slug de agente (sem
    // tabela própria — fase 3+ não implementa agentes de produto).
    scopeId: text('scope_id').notNull(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.scope, table.scopeId)],
);

// Envelope encryption: DEK aleatório por registro, cifrado (wrapped)
// pela chave mestra (env); o segredo do usuário é cifrado pelo DEK.
// Nunca há texto plano no banco — ver infrastructure/security.
export const userCredentials = pgTable(
  'user_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: llmProviderEnum('provider').notNull(),
    wrappedDek: text('wrapped_dek').notNull(),
    dekIv: text('dek_iv').notNull(),
    dekAuthTag: text('dek_auth_tag').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    apiKeyIv: text('api_key_iv').notNull(),
    apiKeyAuthTag: text('api_key_auth_tag').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.userId, table.provider)],
);

// Append-only: metering obrigatório de cada chamada de LLM.
export const tokenUsage = pgTable('token_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  actorKind: actorKindEnum('actor_kind').notNull(),
  actorId: text('actor_id').notNull(),
  provider: llmProviderEnum('provider').notNull(),
  modelId: uuid('model_id').references(() => models.id),
  modelName: text('model_name').notNull(), // snapshot no momento da chamada
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  estimated: boolean('estimated').notNull().default(false),
  costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
  latencyMs: integer('latency_ms').notNull(),
  bindingOrigin: modelBindingScopeEnum('binding_origin'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    sessionId: uuid('session_id').references(() => sessions.id, {
      onDelete: 'cascade',
    }),
    limitMicros: bigint('limit_micros', { mode: 'number' }).notNull(),
    spentMicros: bigint('spent_micros', { mode: 'number' })
      .notNull()
      .default(0),
    policy: budgetPolicyEnum('policy').notNull().default('block'),
    lastThresholdNotified: integer('last_threshold_notified')
      .notNull()
      .default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // unique() em coluna nullable só restringe as linhas não-nulas no
    // Postgres — exatamente "no máximo um budget por projeto/sessão".
    unique('budgets_project_id_unique').on(table.projectId),
    unique('budgets_session_id_unique').on(table.sessionId),
    check(
      'budgets_scope_check',
      sql`(${table.projectId} is not null) <> (${table.sessionId} is not null)`,
    ),
  ],
);

// --- Pipeline de ações propostas ---

export const proposedActions = pgTable(
  'proposed_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // Cursor de paginação monotônico global — bigserial, NÃO gapless por
    // sessão (contraste deliberado com session_events.seq): não há
    // requisito de negócio de "sem gaps" pra ações propostas.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    actionType: text('action_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: actionStatusEnum('status').notNull().default('proposed'),
    resolvedPolicy: permissionPolicyEnum('resolved_policy').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(), // quem propôs
    actorId: text('actor_id').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('proposed_actions_session_seq_idx').on(table.sessionId, table.seq),
  ],
);

// --- Git providers (Fase 2): conexão OAuth + repositório provisionado ---

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
