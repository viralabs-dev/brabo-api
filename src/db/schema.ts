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
import type { TerminalExecutionResult } from '../domain/actions/terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../domain/git/bootstrap-execution-result';

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

// pending → approved | denied; approved/auto_approved → executed | failed
// (ver domain/actions/action-state-machine.ts). "denied" cobre tanto
// recusa manual quanto deny automático da política.
export const actionStatusEnum = pgEnum('action_status', [
  'pending',
  'approved',
  'denied',
  'auto_approved',
  'executed',
  'failed',
]);

// Vocabulário compartilhado por resolved_policy (escalar) e por
// agent_autonomy.mode — o mesmo enum, já que os dois participam da mesma
// decisão em domain/actions/decide.ts.
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

// Handoff entre agentes (Fase 3b): offered → accepted | rejected; accepted →
// completed. Um agente só pode ser ativado numa sessão com um handoff
// `accepted` endereçado a ele (ver domain/sessions/agent-activation.ts) — o
// Criativo é a exceção (inicia por comando do usuário). Cada transição de
// status também vira um session_event `handoff.*` imutável.
export const handoffStatusEnum = pgEnum('handoff_status', [
  'offered',
  'accepted',
  'completed',
  'rejected',
]);

// Ciclo de vida de uma história de backlog (Fase 3b — PO):
//   draft → ready → in_progress → done
// A transição draft→ready é validada NO DOMÍNIO (ver domain/backlog/
// story-readiness.ts): exige DoD e DoR não vazios, ≥1 RF e ≥1 regra de
// negócio vinculada. Sem isso a story não sai de draft.
export const storyStatusEnum = pgEnum('story_status', [
  'draft',
  'ready',
  'in_progress',
  'done',
]);

// user_credentials guarda tanto chaves de LLM quanto tokens de git do
// usuário (github/gitlab) — enum dedicado em vez de alargar llm_provider
// (que também serve models/token_usage, LLM-only de verdade) ou
// reaproveitar git_provider (que tem 'local', sem sentido pra uma
// credencial). Ver docs/adr/0004-git-credential-registration.md.
export const credentialProviderEnum = pgEnum('credential_provider', [
  'ollama',
  'anthropic',
  'openai',
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
    // Permissões não vivem mais no banco — permissions.json físico na raiz
    // do workspace do projeto (ver infrastructure/filesystem/fs-permissions-file-store.ts).
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
    provider: credentialProviderEnum('provider').notNull(),
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
    // 'terminal' | 'git_commit' | 'git_push' | 'pr_open' | 'spend' —
    // validado na borda (DTO), não como enum de banco (mesmo tratamento já
    // dado a session_events.type).
    actionType: text('action_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: actionStatusEnum('status').notNull().default('pending'),
    resolvedPolicy: permissionPolicyEnum('resolved_policy').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(), // quem propôs
    actorId: text('actor_id').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    // Preenchido só depois de executed/failed.
    executionResult: jsonb('execution_result').$type<
      TerminalExecutionResult | GitBootstrapExecutionResult
    >(),
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

// Modo de autonomia de um agente pra um tipo de ação, por projeto — segundo
// estágio de domain/actions/decide.ts. Sem linha, decide() não usa este
// estágio pra nada (nem promove nem nega).
export const agentAutonomy = pgTable(
  'agent_autonomy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    actionType: text('action_type').notNull(),
    mode: permissionPolicyEnum('mode').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.agentId, table.actionType)],
);

// Instruções por agente e projeto (Fase 3a — harness): o arquivo de agente
// que o InstructionFiles do engine lê e mescla com os AGENTS.md do workspace
// (precedência banco > diretório > raiz). Uma linha ativa por (projeto,
// agente); `version` é bumpado no update (não é tabela de histórico).
// `agent` é slug livre (mesma convenção de agent_autonomy.agent_id /
// actor_id — sem FK nem enum). Criada aqui (Drizzle, schema 'public'); o
// engine só LÊ via Ecto schema read-only.
export const agentInstructions = pgTable(
  'agent_instructions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    content: text('content').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.agent)],
);

// Handoffs entre agentes (Fase 3b): o Criativo, ao emitir o product_brief,
// OFERECE um handoff ao PO. `from_agent`/`to_agent` são slugs livres (mesma
// convenção de actor_id — sem FK nem enum). `artifact_id` referencia o
// session_events.id do artefato entregue (o product_brief) — não é FK porque
// session_events.id é ULID de texto e o vínculo é lógico, não relacional.
// Diferente das tabelas de evento, `status` é MUTÁVEL (offered → accepted →
// completed); a história imutável de cada transição vive nos session_events
// `handoff.*`.
export const handoffs = pgTable(
  'handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromAgent: text('from_agent').notNull(),
    toAgent: text('to_agent').notNull(),
    artifactId: text('artifact_id'),
    status: handoffStatusEnum('status').notNull().default('offered'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('handoffs_session_idx').on(table.sessionId)],
);

// --- Backlog (Fase 3b — PO): épicos → histórias → tarefas ---
//
// Gerado pelo PO dentro de uma sessão (sessionId = proveniência) mas
// consultado por projeto. Multi-valor em JSONB (o projeto não usa arrays do
// Postgres — mesma convenção de session_events.payload). `business_rule_ids`
// referencia session_events.id (ULID) dos artefatos artifact.business_rule —
// texto sem FK (mesma escolha de handoffs.artifact_id), vínculo lógico.
export const epics = pgTable('epics', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    epicId: uuid('epic_id')
      .notNull()
      .references(() => epics.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // Requisitos funcionais / não-funcionais (texto livre por item).
    rf: jsonb('rf').$type<string[]>().notNull().default([]),
    rnf: jsonb('rnf').$type<string[]>().notNull().default([]),
    // Regras de negócio que originaram a story (session_events.id).
    businessRuleIds: jsonb('business_rule_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    // Definition of Done / Definition of Ready.
    dod: jsonb('dod').$type<string[]>().notNull().default([]),
    dor: jsonb('dor').$type<string[]>().notNull().default([]),
    status: storyStatusEnum('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('stories_epic_idx').on(table.epicId),
    index('stories_session_idx').on(table.sessionId),
  ],
);

// Tarefas pertencem a uma story e HERDAM o vínculo a regra dela (derivado, não
// armazenado). Folhas da árvore do backlog.
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('tasks_story_idx').on(table.storyId)],
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId)],
);
