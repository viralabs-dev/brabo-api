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
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { TerminalExecutionResult } from '../domain/actions/terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../domain/git/bootstrap-execution-result';
import type { AdrPrExecutionResult } from '../domain/git/adr-pr-execution-result';
import type { GitActionExecutionResult } from '../domain/git/git-action-execution-result';
import type { InfraPrExecutionResult } from '../domain/git/infra-pr-execution-result';
import type { InstructionPatchExecutionResult } from '../domain/instructions/instruction-patch-execution-result';

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

// Ciclo de vida de uma tarefa executável (Fase 4a — devs): todo →
// in_progress → done. Um dev "pega" (claim atômico) uma task `todo` cuja
// story está `ready`; `assigned_to` = agent_id do dev (ex.: "dev-<modulo>").
export const taskStatusEnum = pgEnum('task_status', [
  'todo',
  'in_progress',
  'in_review',
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
  // Fase 4b — Psicólogo: motivo reportado pelo engine na transição pra um
  // estado terminal (heartbeat_timeout/killed/exceção/...) — só populado
  // no caminho de término reportado pelo engine (ReportSessionTerminationUseCase);
  // fecho humano/gracioso fica null. Alimenta a classificação determinística
  // de causa (crash/kill/timeout) no contexto do Psicólogo.
  terminationReason: text('termination_reason'),
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
      | TerminalExecutionResult
      | GitBootstrapExecutionResult
      | AdrPrExecutionResult
      | GitActionExecutionResult
      | InfraPrExecutionResult
      | InstructionPatchExecutionResult
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
    // Módulos (nomes) do module_map vigente que a story realiza (Fase 3b —
    // Arquiteto). Validação cruzada: story não vai a `ready` se algum módulo
    // referenciado não existir no module_map. Vazio = pendência, não bloqueio.
    moduleIds: jsonb('module_ids').$type<string[]>().notNull().default([]),
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
    // Fase 4a — execução: status + agente que pegou a task (claim atômico).
    status: taskStatusEnum('status').notNull().default('todo'),
    assignedTo: text('assigned_to'),
    // DevAgent devolveu a task com diagnóstico (limite de iterações, orçamento
    // excedido, ou report_blocked) — status volta pra `todo`, mas fica
    // marcada aqui pra não ser reclaimada automaticamente e pra UI destacar.
    blocked: boolean('blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    // Fase 4a — gates de PR: null até a PR abrir; awaiting_qa/awaiting_secops/
    // awaiting_user daí em diante (ver pr-gate-state-machine.ts). Contador
    // zera a cada avanço de gate, incrementa a cada changes_requested.
    gateStatus: text('gate_status'),
    gateCorrectionCount: integer('gate_correction_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('tasks_story_idx').on(table.storyId)],
);

// Artefatos de infra (Fase 4a — InfraAgent): PR de Dockerfiles/compose/CI
// gated pelos MESMOS QA/SecOps do dev, mas sem task/story/worktree por trás
// (arquivos nascem como conteúdo direto, igual ADR) — tabela paralela leve a
// `tasks`, reaproveitando a MESMA nextGateStatus (pr-gate-state-machine.ts).
// Diferente de tasks (que existem ANTES da PR e abrem o gate depois), o
// artefato só nasce quando a PR já foi aberta — gateStatus já chega
// 'awaiting_qa'.
export const infraArtifacts = pgTable(
  'infra_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // Id da proposed_action `open_infra_pr` que abriu esta PR — o engine só
    // conhece esse id de volta (resposta de propose_action).
    prActionId: uuid('pr_action_id').notNull(),
    gateStatus: text('gate_status').notNull().default('awaiting_qa'),
    gateCorrectionCount: integer('gate_correction_count').notNull().default(0),
    blocked: boolean('blocked').notNull().default(false),
    blockedReason: text('blocked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('infra_artifacts_project_idx').on(table.projectId),
    index('infra_artifacts_pr_action_idx').on(table.prActionId),
  ],
);

// module_map (Fase 3b — Arquiteto): mapa de módulos do projeto, validado
// contra ciclos de dependência. Cada emissão é uma linha nova; o **vigente** é
// o de maior `version` do projeto (histórico imutável, sem UPDATE). Usado pela
// validação cruzada story↔módulos. `modules` = [{name, stack, responsibility,
// dependsOn: string[]}] (dependsOn referencia `name` de outro módulo).
export const moduleMaps = pgTable(
  'module_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    modules: jsonb('modules')
      .$type<
        {
          name: string;
          stack: string;
          responsibility: string;
          dependsOn: string[];
        }[]
      >()
      .notNull()
      .default([]),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('module_maps_project_idx').on(table.projectId)],
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

// --- Psicólogo (Fase 4b) ---

// Uma linha por RUN de análise CONCLUÍDO COM SUCESSO (nunca gravado se o
// ToolLoop estourar limite/orçamento sem emitir hipóteses — isso permite
// um retry legítimo depois de uma falha, sem confundir com "duplicar uma
// análise já concluída"). O índice parcial único é a "chave única
// session_id + já processado" da CLAUDE.md: no máximo UMA análise
// `superseded=false` por sessão, sempre — reprocessamento explícito
// (triggeredBy='manual') marca a antiga `superseded=true` (nunca apaga)
// e insere uma nova, preservando histórico.
export const psychologistAnalyses = pgTable(
  'psychologist_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    tier: text('tier').notNull(),
    triggeredBy: text('triggered_by').notNull().default('auto'),
    supersedes: uuid('supersedes'),
    superseded: boolean('superseded').notNull().default(false),
    eventCountAtAnalysis: integer('event_count_at_analysis').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('psychologist_analyses_current_idx')
      .on(table.sessionId)
      .where(sql`${table.superseded} = false`),
  ],
);

// Tabela MUTÁVEL do ciclo de vida da hipótese (proposed -> accepted |
// dismissed) — session_events é append-only (CLAUDE.md), então o estado
// que muda precisa morar aqui, igual tasks.gate_status/
// infra_artifacts.gate_status; cada transição TAMBÉM emite um
// session_event imutável correspondente (trilha de auditoria).
export const psychologistHypotheses = pgTable(
  'psychologist_hypotheses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    analysisId: uuid('analysis_id')
      .notNull()
      .references(() => psychologistAnalyses.id, { onDelete: 'cascade' }),
    // Texto livre (não enum) — precisa caber agent ids dinâmicos como
    // dev-<modulo>, além dos fixos (criativo/po/arquiteto/qa/secops/infra).
    agenteAlvo: text('agente_alvo').notNull(),
    observacao: text('observacao').notNull(),
    hipotese: text('hipotese').notNull(),
    sugestao: text('sugestao').notNull(),
    // Inteiro 0-100 — convenção do repo pra ratio/dinheiro é inteiro
    // (mesmo espírito de micro-USD), não float.
    confiancaPercent: integer('confianca_percent').notNull(),
    evidenceEventIds: jsonb('evidence_event_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    terminationAnalysis: jsonb('termination_analysis').$type<{
      causa: string;
      estadoDaSessao: string;
      analise: string;
    } | null>(),
    status: text('status').notNull().default('proposed'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('psychologist_hypotheses_project_idx').on(table.projectId),
    index('psychologist_hypotheses_analysis_idx').on(table.analysisId),
  ],
);

// --- Anamnese (Fase 4b) ---

// Histórico APPEND-ONLY das instruções de agente. `agent_instructions`
// continua sendo o ponteiro do "current" (é o que o engine lê via Ecto
// read-only, sem mudança de schema lá); toda escrita grava a versão aqui
// ANTES de bumpar o current. Rollback é operação PRA FRENTE: copia o
// conteúdo de uma versão antiga numa versão NOVA — nada é apagado.
// `sourceHypothesisId` é o que dá rastreabilidade hipótese→patch→versão.
export const agentInstructionVersions = pgTable(
  'agent_instruction_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    // proposed_action `instruction_patch` que originou (null pra seed e
    // pra escrita direta) — vínculo lógico, sem FK (mesma convenção de
    // infra_artifacts.prActionId).
    sourceActionId: uuid('source_action_id'),
    sourceHypothesisId: uuid('source_hypothesis_id'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.projectId, table.agent, table.version),
    index('agent_instruction_versions_agent_idx').on(
      table.projectId,
      table.agent,
    ),
  ],
);

// Perfil de proficiência derivado pela Anamnese. `competency` é validada
// contra o catálogo hard-coded do domínio (domain/anamnese/
// competency-catalog.ts) — atributos sensíveis são estruturalmente
// inalcançáveis, não uma instrução de prompt.
export const proficiencyProfiles = pgTable(
  'proficiency_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    competency: text('competency').notNull(),
    level: text('level').notNull(),
    // "os porquês" — o raciocínio + os event ids que sustentam o nível.
    rationale: text('rationale').notNull(),
    evidenceEventIds: jsonb('evidence_event_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique().on(table.projectId, table.userId, table.competency),
    index('proficiency_profiles_project_idx').on(table.projectId),
  ],
);

// Usuário que apagou o próprio perfil: apagar apaga DE VERDADE (delete
// das linhas) e o opt-out impede a re-derivação na rodada seguinte —
// sem isso o "apagar" seria cosmético. Reversível via opt-in.
export const anamneseOptOuts = pgTable(
  'anamnese_opt_outs',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })],
);

// Fila COM ORIGEM: hipótese aceita do Psicólogo vira input priorizado da
// próxima rodada da Anamnese. Enfileirada por AcceptHypothesisUseCase
// (determinístico, sem depender de rotear o outbox).
export const anamneseQueue = pgTable(
  'anamnese_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    origin: text('origin').notNull().default('hypothesis'),
    hypothesisId: uuid('hypothesis_id')
      .notNull()
      .references(() => psychologistHypotheses.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => [
    unique().on(table.hypothesisId),
    index('anamnese_queue_project_idx').on(table.projectId),
  ],
);

// Uma linha por rodada CONCLUÍDA (run falho não grava — mesma disciplina
// de psychologist_analyses). A janela da próxima rodada começa no
// `windowTo` da última.
export const anamneseRuns = pgTable(
  'anamnese_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    windowFrom: timestamp('window_from', { withTimezone: true }).notNull(),
    windowTo: timestamp('window_to', { withTimezone: true }).notNull(),
    eventCount: integer('event_count').notNull(),
    profileCount: integer('profile_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('anamnese_runs_project_idx').on(table.projectId)],
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
