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

// FASE 20 (RN-097) — a INTENÇÃO com que a sessão foi aberta. `consultiva` é só
// conversa; `criativa` é a que produz, e a única que pode entrar em execução.
// Não confundir com ESTADO de execução, que continua sendo o evento
// `execution.activated` — ver domain/sessions/session-kind.ts.
export const sessionKindEnum = pgEnum('session_kind', [
  'consultiva',
  'criativa',
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

export const llmProviderEnum = pgEnum('llm_provider', [
  'ollama',
  'anthropic',
  'openai',
  'openrouter',
  'nvidia-nim',
  'together',
  'deepinfra',
  'bitdeer',
  'vultr',
]);

// workspace < project < area < agent < session, do menos pro mais específico —
// ver domain/llm/binding-resolver.ts pra precedência de resolução.
//
// `area` entrou na FASE 23 (ADR 0064): é o modelo PADRÃO que o lead e os
// subagentes de uma área compartilham, e o binding de `agent` é a divergência
// que o sobrepõe.
export const modelBindingScopeEnum = pgEnum('model_binding_scope', [
  'workspace',
  'project',
  'area',
  'agent',
  'session',
]);

// Realidade REMOTA do modelo, observada pelo sync de catálogo (Fase 9c) — eixo
// diferente de `is_active`, que é a curadoria do owner. Um modelo pode estar
// ativo E indisponível: é esse cruzamento que gera aviso no binding. Manter os
// dois separados é o que preserva a escolha do owner quando o modelo volta.
export const modelAvailabilityEnum = pgEnum('model_availability', [
  'available',
  'unavailable',
]);

// Quem originou a mudança de preço, na auditoria (Fase 9c).
export const priceChangeSourceEnum = pgEnum('price_change_source', [
  'manual',
  'sync',
]);

export const budgetPolicyEnum = pgEnum('budget_policy', ['block', 'allow']);

// Backup (Fase 5). `daily` é toda execução; `weekly` marca a que também virou
// cópia na retenção semanal — as duas retenções são podadas separadamente.
export const backupKindEnum = pgEnum('backup_kind', ['daily', 'weekly']);
// Só dois estados terminais: o job ou subiu o objeto e registrou o tamanho, ou
// não. "em andamento" não existe aqui porque a linha só é escrita no fim.
export const backupStatusEnum = pgEnum('backup_status', ['ok', 'failed']);

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

// A ORIGEM de uma falha de agente (Fase 8b, ADR 0020/0038) — nunca por
// eliminação, sempre nomeada. `codigo` e não `código`: os enums deste
// arquivo não usam acento (ver os demais). Hoje só populada por
// `delegations` e `tasks.blockedOrigin`; os ~18 pontos de bloqueio da Fase
// 4a (`Engine.Dev.AgentIo.block_task/3`) não foram retrofitados nesta
// entrega — é dívida registrada no ADR 0038, não esquecimento.
export const failureOriginEnum = pgEnum('failure_origin', [
  'infra',
  'modelo',
  'codigo',
  'politica',
]);

// Desfecho de uma delegação da área de QA (Fase 8b, ADR 0038). Sem `pending`:
// o `QaLeadServer` resolve cada delegação SÍNCRONA, numa rodada só — toda
// linha nasce já no estado final. `dispensed` é a decisão do lead de NÃO
// delegar (ex.: story sem RNF de performance) — sempre registrada, nunca
// silêncio (CLAUDE.md, Fase 8b item 2).
export const delegationStatusEnum = pgEnum('delegation_status', [
  'completed',
  'failed',
  'dispensed',
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

// QUEM promove uma story de draft para ready (Fase 12c, RN-048).
// `manual` (default de projeto NOVO): o PO propõe e o USUÁRIO decide.
// `auto`: o comportamento anterior à 12c, agora opt-in — a story completa
// já nasce ready. Projetos que existiam antes da migração 0033 ficaram em
// `auto` de propósito: mudar o comportamento debaixo de quem já opera não
// é uma escolha que o produto pode fazer sozinho.
export const storyPromotionModeEnum = pgEnum('story_promotion_mode', [
  'manual',
  'auto',
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
  'openrouter',
  'nvidia-nim',
  'together',
  'deepinfra',
  'bitdeer',
  'vultr',
  'github',
  'gitlab',
]);

// --- Identidade ---

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULLABLE desde a Fase 7a: usuário criado pelo auth first-party não tem
    // sub do Keycloak. Postgres permite vários NULL numa coluna unique, então
    // o `onConflictDoUpdate` do upsert do Keycloak continua funcionando sem
    // mudança — e a coluna some de vez na 7.2, quando o emissor for trocado.
    keycloakSub: text('keycloak_sub').unique(),
    email: text('email').notNull(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Unicidade por e-mail NORMALIZADO. Sem `lower()`, "Ana@brabo.dev" e
    // "ana@brabo.dev" seriam contas distintas — e como o login busca pelo
    // e-mail em minúsculas, a segunda conta ficaria inacessível para sempre.
    uniqueIndex('users_email_lower_idx').on(sql`lower(${table.email})`),
  ],
);

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
    //
    // Teto de tokens POR TASK dos dev agents (Fase 4a), em micro-USD. Nulo usa
    // o default do domínio. Distinto de `budgets`, que é o teto GLOBAL de gasto
    // do projeto/sessão: este é por execução de task do ToolLoop. Fica aqui
    // porque "configurável por projeto" precisa sobreviver — antes o valor só
    // existia como parâmetro da ativação e se perdia na reativação.
    taskBudgetMicros: bigint('task_budget_micros', { mode: 'number' }),
    // Circuit breaker por dev agent (Fase 12b, RN-047): quantas tasks
    // TERMINAM blocked em sequência até o agente parar em idle_tripped.
    // Nulo usa o default do domínio. Mesmo motivo do campo acima: precisa
    // sobreviver à reativação, não só existir como parâmetro dela.
    maxConsecutiveBlocked: integer('max_consecutive_blocked'),
    // Quem promove story a `ready` (Fase 12c, RN-048). NOT NULL com default
    // `manual` — diferente dos dois tetos acima, que são nullable porque
    // "nulo = default do domínio". Aqui o valor É a decisão, e uma decisão
    // de autoridade não pode ficar implícita.
    storyPromotion: storyPromotionModeEnum('story_promotion')
      .notNull()
      .default('manual'),
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

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    status: sessionStatusEnum('status').notNull().default('created'),
    // FASE 20 (RN-097) — INTENÇÃO de criação, escolhida por quem abre a sessão
    // e imutável depois. O DEFAULT é o tipo que pode MENOS: linha que chegue
    // sem tipo declarado não ganha o direito de executar. A rota exige o campo
    // no corpo, então o default só cobre caminho que não passa por ela.
    kind: sessionKindEnum('kind').notNull().default('consultiva'),
    // FASE 20 (RN-098) — nome amigável, opcional. NUNCA substitui a hashtag
    // (`#` + 8 caracteres do id): é ela que se cola numa URL, e nome escolhido
    // por pessoa não é único. `null` significa "sem nome", e a tela degrada
    // para a hashtag sozinha.
    name: text('name'),
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
    // Fase 5 — OpenTelemetry: `traceparent` W3C da span raiz da sessão.
    //
    // Uma sessão dura minutos ou horas, e uma span OTel só aparece no backend
    // quando TERMINA — uma raiz aberta esse tempo todo seria invisível no Tempo
    // justamente enquanto interessa, e some de vez se a sessão nunca encerrar
    // direito. Então a raiz é curta (`session.create`) e o traceparent dela é
    // persistido aqui: todo trabalho posterior (turno de agente, tool call,
    // chamada de LLM, gate, job do Oban) usa este valor como PARENT REMOTO,
    // compartilha o mesmo trace_id, e a sessão inteira é recuperável no Tempo
    // por um id só.
    traceParent: text('trace_parent'),
  },
  (table) => [
    // Fase 5 — a gauge `brabo_sessions_active` filtra por status e agrupa por
    // projeto a cada 15s; sem índice isso é seq scan na tabela de sessões, que
    // só cresce.
    index('sessions_status_project_idx').on(table.status, table.projectId),
  ],
);

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

// --- Transactional outbox (consumido pelo Engine.Outbox.Drain) ---

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    // Fase 5 — metadado de TRANSPORTE, separado do payload de domínio.
    //
    // Carrega o `traceparent` para que o trabalho assíncrono disparado por um
    // evento continue na mesma trace de quem o produziu. Coluna própria e não
    // uma chave no `payload` porque o engine desserializa payload por tipo de
    // evento: misturar transporte com domínio ali envenenaria os 18 pontos que
    // escrevem no outbox e qualquer validação estrita futura.
    metadata: jsonb('metadata').notNull().default({}),
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
    /** Serve de `context_length` nas capabilities — já existia desde a Fase 1. */
    contextWindow: integer('context_window'),
    // Capabilities POR MODELO (Fase 9a — ADR 0041). Colunas discretas em vez
    // de um jsonb porque o filtro "aptos para agentes" da Fase 9c precisa ser
    // um WHERE, e porque uma capability sem coluna é uma capability que
    // ninguém consegue consultar.
    //
    // O default de `supports_tool_calling` é FALSE de propósito: modelo
    // descoberto por sync (Fase 9c) entra sem promessa que ninguém verificou.
    supportsToolCalling: boolean('supports_tool_calling')
      .notNull()
      .default(false),
    supportsStreaming: boolean('supports_streaming').notNull().default(true),
    supportsVision: boolean('supports_vision').notNull().default(false),
    /**
     * Raciocínio explícito (thinking) e geração de imagem — as duas capabilities
     * que o catálogo do OpenRouter publica e o parser descartava (`architecture`
     * e `supported_parameters` chegavam e eram jogados fora).
     *
     * `false` aqui significa "este provider não declarou", não "o modelo não
     * faz". É a regra do ADR 0041: capability só é afirmada quando provada, e o
     * provider que não publica deixa o valor como está em vez de zerá-lo.
     */
    supportsReasoning: boolean('supports_reasoning').notNull().default(false),
    generatesImage: boolean('generates_image').notNull().default(false),
    // Preço digitado à mão a partir da doc do provider, em vez de vindo de
    // sync (Fase 9b). Quem sincroniza preço na Fase 9c NÃO pode sobrescrever
    // uma linha marcada aqui sem decisão explícita: o número manual costuma
    // ser o único que existe para provider que não expõe catálogo.
    manualPricing: boolean('manual_pricing').notNull().default(true),
    // A curadoria NÃO mora mais aqui. Ela era `is_active` nesta linha, e por
    // isso um owner do workspace A ativando um modelo o ativava para o B —
    // consequência registrada como backlog no próprio ADR 0042. Agora vive em
    // `workspace_models`, uma linha por (workspace, modelo). O que sobra em
    // `models` é fato do PROVIDER: nome, preço, capabilities, disponibilidade
    // — igual para todo mundo (ADR 0049).
    availability: modelAvailabilityEnum('availability')
      .notNull()
      .default('available'),
    /** Última vez que o sync viu este modelo no catálogo remoto. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.provider, table.name)],
);

/**
 * A curadoria de modelo, POR WORKSPACE (ADR 0049).
 *
 * Antes era `models.is_active`, uma coluna só para a instalação inteira: um
 * owner do workspace A ligando um modelo o ligava para o B. O catálogo em si
 * continua global de propósito — nome, preço e capabilities são fato do
 * provider, e duplicá-los por workspace criaria N verdades sobre o mesmo
 * modelo, além de partir `token_usage.model_id` ao meio.
 *
 * **Ausência de linha é o desligado.** Não existe estado "nunca decidido"
 * separado de "desligado": modelo descoberto pelo sync simplesmente não tem
 * linha aqui, e é isso que preserva a RN-043 sem coluna nenhuma em `models`.
 * A linha só nasce quando alguém decide, e guarda QUEM decidiu.
 */
export const workspaceModels = pgTable(
  'workspace_models',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Para que este workspace usa o modelo (`codigo`, `documentacao`, …).
     *
     * Vive aqui, e não em `models`, porque é OPINIÃO de quem opera e não
     * capability do provider: o mesmo modelo pode ser "o de código" num
     * workspace e o de conversa barata em outro. Vocabulário fechado em
     * `domain/llm/model-uses.ts` — coluna de texto e não enum do Postgres pela
     * mesma razão de `delegations.area` (Fase 8): uso novo não deve exigir
     * migração de tipo.
     */
    uses: text('uses')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * Quem decidiu. `null` só nas linhas nascidas da migração de dados, que
     * vieram de uma curadoria global sem dono registrado — é a diferença
     * entre "não sabemos" e "não houve pessoa".
     */
    curatedBy: uuid('curated_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.modelId] }),
    index('workspace_models_workspace_idx').on(table.workspaceId),
  ],
);

export const modelBindings = pgTable(
  'model_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: modelBindingScopeEnum('scope').notNull(),
    // UUID puro em `workspace`, `project` e `session`, que já se identificam
    // sozinhos. Em `agent` e `area` é COMPOSTO — `<projectId>:<slug|chave>` —
    // porque esses dois existem POR PROJETO e o mesmo `qa` aparece em todos
    // (ADR 0064). O formato e a validação moram em
    // domain/llm/binding-scope-id.ts; agente e área continuam sem tabela
    // própria, como em session_events.actor_id.
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

// Auditoria de preço (Fase 9c, RN-044). Append-only como `session_events`:
// nunca há UPDATE aqui.
//
// Por que tabela própria e não `outbox_events`: o dreno do engine
// (`Engine.Outbox.Drain.run_once/0`) filtra `aggregate_type == "session"`, então
// uma linha de preço ficaria com `processed_at` nulo para sempre e sujaria a
// métrica de lag da outbox. Isto é log de domínio, não comando.
export const modelPriceChanges = pgTable('model_price_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  modelId: uuid('model_id')
    .notNull()
    .references(() => models.id),
  inputBeforeMicros: bigint('input_before_micros', {
    mode: 'number',
  }).notNull(),
  inputAfterMicros: bigint('input_after_micros', { mode: 'number' }).notNull(),
  outputBeforeMicros: bigint('output_before_micros', {
    mode: 'number',
  }).notNull(),
  outputAfterMicros: bigint('output_after_micros', {
    mode: 'number',
  }).notNull(),
  source: priceChangeSourceEnum('source').notNull(),
  /** `null` quando veio do sync — não há pessoa por trás. */
  changedBy: uuid('changed_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  // Os preços que PRODUZIRAM o `cost_micros` acima (Fase 9c, RN-044). Sem
  // eles o custo já era congelado (ninguém recalcula), mas não era
  // REPRODUZÍVEL: não dava para conferir `tokens × preço = custo` depois que a
  // linha de `models` mudasse.
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
  latencyMs: integer('latency_ms').notNull(),
  bindingOrigin: modelBindingScopeEnum('binding_origin'),
  // Provider SUBJACENTE, quando a chamada passou por um hub que informa quem
  // serviu (Fase 9b). Texto livre e não enum: o conjunto é do hub, muda sem
  // aviso e não é nosso para versionar. `null` = não veio de hub, ou o hub
  // não informou.
  upstreamProvider: text('upstream_provider'),
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

// Delegação interna de uma área a um subagente (Fase 8b, ADR 0038). Nunca
// visível como handoff — é o que preserva "o lead é o único contato
// externo". Primeira instância: a área "qa", `leadAgent: "qa-lead"`
// delegando a `qa-automacao`/`qa-performance-seguranca`.
//
// Sem status `pending`: o `QaLeadServer` resolve cada delegação síncrona,
// numa rodada só, e só chama esta rota já com o desfecho final.
//
// `parecerArtifactId` é TEXT sem FK — mesma escolha de `handoffs.artifactId`
// (`session_events.id` é ULID em `text`, vínculo lógico, não chave
// estrangeira).
//
// `agent_areas`/`agent_area_members` existem desde a FASE 14d (ADR 0053, que
// revogou o corte do ADR 0038). `area` continua TEXT e não enum: a área de
// `dev` tem um membro por MÓDULO do `module_map`, decidido pelo Arquiteto e
// diferente em cada projeto — não é enumerável em migração.
//
// `taskId` é NULLABLE (Fase 8c): a área de Infra delega sobre a SESSÃO, sem
// task de backlog por trás — só existe PR de infra, nunca task. QA (Fase
// 8b) sempre preenche; nasceu NOT NULL até a segunda instância do modelo
// (ADR 0038) provar que a suposição "toda área tem task" era estreita
// demais.
/**
 * As áreas de agente, POR PROJETO (ADR 0053, FASE 14d).
 *
 * Antes eram uma lista hardcoded em `apps/web/src/lib/agents.ts` — `qa` e
 * `infra` com membros fixos. Isso bastava enquanto as áreas eram fixas, e
 * deixou de bastar quando a área de `dev` entrou: os membros dela são um por
 * módulo do `module_map`, decididos pelo Arquiteto, e portanto diferentes em
 * cada projeto. O que não é enumerável em código passa a ser dado.
 *
 * `max_parallel` é o teto que o LEAD pode usar sem perguntar — não o teto do
 * que o usuário pode aprovar. Default 2, configurável por lead.
 *
 * O teto é da SESSÃO, não do módulo. Contar por módulo permitiria N módulos ×
 * 2 agentes sem autorização nenhuma, que é o buraco de hoje com outro nome.
 */
export const agentAreas = pgTable(
  'agent_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `dev`, `qa`, `infra`. TEXT pelo mesmo motivo de `delegations.area`. */
    key: text('key').notNull(),
    /** O contato externo da área (ADR 0038). */
    leadAgentId: text('lead_agent_id').notNull(),
    maxParallel: integer('max_parallel').notNull().default(2),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique().on(table.projectId, table.key)],
);

/**
 * Quem pertence a cada área.
 *
 * Membro não é endereçável por handoff externo (ADR 0038) — é o lead que
 * responde pela área. É por isso que a área de `dev` muda o endereçamento:
 * os `dev-<modulo>` deixam de ser agentes sem área.
 */
export const agentAreaMembers = pgTable(
  'agent_area_members',
  {
    areaId: uuid('area_id')
      .notNull()
      .references(() => agentAreas.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.areaId, table.agentId] })],
);

export const delegations = pgTable(
  'delegations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // Nullable: a área de Infra (Fase 8c) delega sobre a SESSÃO, sem task de
    // backlog por trás — só QA (Fase 8b) sempre preenche.
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    area: text('area').notNull(),
    leadAgent: text('lead_agent').notNull(),
    subagent: text('subagent').notNull(),
    status: delegationStatusEnum('status').notNull(),
    parecerArtifactId: text('parecer_artifact_id'),
    failureOrigin: failureOriginEnum('failure_origin'),
    failureReason: text('failure_reason'),
    justification: text('justification'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('delegations_task_idx').on(table.taskId),
    check(
      'delegations_completed_tem_parecer',
      sql`${table.status} <> 'completed' or ${table.parecerArtifactId} is not null`,
    ),
    check(
      'delegations_failed_tem_origem',
      sql`${table.status} <> 'failed' or ${table.failureOrigin} is not null`,
    ),
    check(
      'delegations_dispensed_tem_justificativa',
      sql`${table.status} <> 'dispensed' or ${table.justification} is not null`,
    ),
  ],
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
    // O PO terminou a story e ela AGUARDA a decisão do usuário (Fase 12c,
    // RN-048). Flag booleana, e NÃO um valor novo em `story_status`, de
    // propósito: `status = 'ready'` é o único portão de claimabilidade no
    // `claimNext` (backlog.repository.ts) — mexer no enum mexeria em quem
    // pode pegar trabalho. Aqui a story continua `draft` (logo, nenhuma task
    // dela é pegável) e a flag só diz que ela está pronta para ser olhada.
    proposedReady: boolean('proposed_ready').notNull().default(false),
    // A recusa do usuário (Fase 12c): por que ele devolveu a story ao PO.
    // Fica na linha, e não só no event log, porque é o que a tela do Backlog
    // mostra e o que o PO precisa ler para revisar — e porque o push ao
    // PoServer é best-effort: se o processo estiver morto, isto aqui é o que
    // garante que a recusa não se perdeu.
    returnedReason: text('returned_reason'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
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
    // A consulta da seção "Aguardando sua promoção" e do badge de contagem:
    // as proposed de um projeto. Parcial porque a esmagadora maioria das
    // stories não está proposta.
    index('stories_proposed_idx')
      .on(table.projectId)
      .where(sql`${table.proposedReady}`),
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
    // Fase 8b (ADR 0020/0038) — a ORIGEM do bloqueio, quando conhecida.
    // NULLABLE de propósito: só o caminho novo do `QaLeadServer` a preenche;
    // os pontos de bloqueio da Fase 4a (worktree, contexto, limite de
    // iterações do Dev) não foram retrofitados nesta entrega. Campo NOVO ao
    // lado de `blockedReason`, nunca substituição.
    blockedOrigin: failureOriginEnum('blocked_origin'),
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
  (table) => [
    index('tasks_story_idx').on(table.storyId),
    // Fase 5 — a gauge `brabo_tasks_blocked` roda a cada 15s. Índice PARCIAL:
    // a esmagadora maioria das tasks não está bloqueada, então indexar só as
    // que estão mantém o índice pequeno e a varredura proporcional ao que
    // realmente interessa.
    index('tasks_blocked_idx')
      .on(table.storyId)
      .where(sql`${table.blocked}`),
  ],
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
    // QUANDO foi substituída. A cadeia `supersedes` já diz por quem, mas
    // sem isto não se sabe quando — e "substitui a versão anterior com
    // histórico" só é auditável com a data da troca.
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
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

// --- Operação (Fase 5): backup e rate limit ---

/**
 * Execuções do CronJob de backup — a FONTE das métricas `brabo_backup_*`.
 *
 * Por que o resultado do backup mora no banco e não num Pushgateway: seria um
 * componente a mais, uma segunda fonte de verdade, e um lugar onde a métrica
 * sobrevive ao fato que ela descreve (a série continua publicada depois que o
 * job sumiu). Aqui o `DomainGaugesCollector`, que já roda num timer, lê esta
 * tabela e publica os gauges — e o runbook de restore ganha histórico
 * consultável de brinde.
 *
 * A linha é gravada SEMPRE, inclusive em falha: é o `status = 'failed'` que
 * transforma um backup quebrado em alerta em vez de silêncio.
 */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    kind: backupKindEnum('kind').notNull().default('daily'),
    status: backupStatusEnum('status').notNull(),
    // Nulo quando o job falhou antes de subir o objeto.
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => [
    // O collector pergunta "qual foi o último sucesso?" a cada 15 s, e o
    // restore procura a janela de UM object_key. Sem índice as duas viram seq
    // scan numa tabela que só cresce.
    index('backup_runs_last_success_idx')
      .on(table.finishedAt)
      .where(sql`${table.status} = 'ok'`),
    index('backup_runs_object_key_idx').on(table.objectKey),
  ],
);

/**
 * Janela deslizante do rate limit (Fase 5, item 7).
 *
 * Uma linha por request contado. O CLAUDE.md proíbe Redis (as filas ficam no
 * Postgres via Oban), então a janela vive aqui — o custo é um INSERT por
 * request, assumido e documentado no ADR 0027, com `RATE_LIMIT_ENABLED` para
 * desligar.
 *
 * Sem chave estrangeira para `users` de propósito: o balde de IP não tem
 * usuário, e a FK obrigaria a apagar histórico de rate limit ao remover um
 * usuário — exatamente o registro que se quer preservar num incidente de abuso.
 */
export const rateLimitHits = pgTable(
  'rate_limit_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // `user:<uuid>` ou `ip:<endereço>`.
    bucketKey: text('bucket_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composto e nesta ordem: a consulta é sempre "quantos hits deste balde
    // depois de T". Índice só em bucket_key faria o Postgres varrer todo o
    // histórico do balde para filtrar por tempo depois.
    index('rate_limit_hits_bucket_idx').on(table.bucketKey, table.occurredAt),
    // A poda apaga por tempo, sem balde — precisa do índice próprio.
    index('rate_limit_hits_occurred_idx').on(table.occurredAt),
  ],
);

// --- Auth first-party (Fase 7a) ---

// Motivo da revogação de um refresh token. Enum e não texto livre porque o
// conjunto é fechado e cada valor dispara leitura diferente numa investigação:
// `reuse_detected` é sinal de roubo, `logout` é o usuário, `password_reset` é
// resposta a suspeita de comprometimento.
export const refreshRevokeReasonEnum = pgEnum('refresh_revoke_reason', [
  'reuse_detected',
  'logout',
  'password_reset',
  'family_max_age',
]);

// Propósito de um token de conta. Uma tabela com enum, não três tabelas: a
// mecânica é idêntica (segredo aleatório, hash em repouso, TTL, consumo único,
// supersede dos irmãos) e o que muda é DADO — TTL e efeito. Três tabelas
// significariam três cópias do UPDATE atômico de consumo, que é a única coisa
// aqui que não dá para errar duas vezes.
export const accountTokenPurposeEnum = pgEnum('account_token_purpose', [
  'email_verification',
  'password_reset',
  // Usuário importado do Keycloak: senha não migra (Fase 7, item 4), então a
  // primeira senha nasce por este fluxo. O valor entra agora porque adicioná-lo
  // depois custaria migração de enum numa fase em que ele já seria necessário.
  'set_initial_password',
]);

/**
 * Senha do usuário — Fase 7a, item 1.
 *
 * Nome propositalmente diferente de `user_credentials`, que guarda chaves de
 * LLM e tokens de git com envelope encryption. São coisas opostas: aquilo é
 * segredo RECUPERÁVEL (o sistema precisa do valor em claro para chamar a API
 * do provider), isto é verificador de senha, que nunca volta a texto. Chamar
 * as duas de "credentials" convidaria a reusar o envelope aqui, que seria erro
 * de segurança, não de nomenclatura.
 */
export const authCredentials = pgTable('auth_credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  // A string codificada do argon2id, que já embute algoritmo, versão, m, t, p
  // e o salt. Guardar os parâmetros em coluna separada duplicaria o que o
  // próprio formato carrega, com risco de divergirem no re-hash.
  passwordHash: text('password_hash').notNull(),
  // Quando a senha mudou pela última vez. É o que um re-hash oportunista e uma
  // política de expiração futura vão consultar.
  passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Refresh tokens opacos com rotação obrigatória — Fase 7a, item 1.
 *
 * ## Por que HMAC-SHA256 e não argon2
 *
 * O token tem 256 bits de CSPRNG: não existe dicionário contra isso, então o
 * custo do argon2 compraria zero bit. E argon2 tem salt por registro, o que
 * tornaria o hash função de (token, salt) em vez de só do token — e
 * `where token_hash = $1` ficaria impossível. Ver auth-key-material.ts.
 *
 * ## A família
 *
 * Um login nasce uma família. Cada refresh consome o token atual (`rotated_at`)
 * e emite um filho com o MESMO `family_id`. Apresentar um token já rotacionado
 * é a assinatura do roubo: alguém está usando uma cópia. A resposta é matar a
 * família inteira.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    // Herdado do pai, sem alteração, por toda a cadeia. É o teto ABSOLUTO da
    // sessão: sem ele, rotação a cada 15 min dá sessão eterna, e ninguém
    // percebe até alguém perguntar quanto tempo uma sessão pode viver.
    familyStartedAt: timestamp('family_started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Consumo NORMAL. Ortogonal a revoked_at de propósito: "você apresentou um
    // token que já foi gasto" (sinal de roubo, cascata) é diferente de "você
    // apresentou um token que a cascata de outro matou" (vítima a jusante,
    // sem novo alarme). Colapsar os dois faria cada revogação de família gerar
    // N alarmes falsos conforme as outras abas do usuário voltassem.
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: refreshRevokeReasonEnum('revoked_reason'),
    issuedIp: text('issued_ip'),
    issuedUserAgent: text('issued_user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('refresh_tokens_hash_idx').on(table.tokenHash),
    index('refresh_tokens_family_idx').on(table.familyId),
    index('refresh_tokens_user_idx').on(table.userId),
    // A poda apaga por tempo — índice próprio, igual ao de rate_limit_hits.
    index('refresh_tokens_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Tokens de uso único de verificação de e-mail e reset de senha — Fase 7a,
 * item 3.
 *
 * Estes viajam em URL, então acabam em log de provedor de e-mail, histórico do
 * browser e cabeçalho `Referer`. O pepper protege contra dump do banco;
 * nenhuma coluna protege uma URL vazada. Daí o TTL do reset ser curto.
 */
export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: accountTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    // Distinto de consumed_at: 'superseded' (pediu outro link) e
    // 'password_changed' (a senha mudou por outro caminho) invalidam sem que
    // ninguém tenha usado o token.
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidatedReason: text('invalidated_reason'),
    requestedIp: text('requested_ip'),
    consumedIp: text('consumed_ip'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('account_tokens_hash_idx').on(table.tokenHash),
    // Parcial: o supersede na emissão só olha os vivos, que são um ou dois.
    index('account_tokens_live_idx')
      .on(table.userId, table.purpose)
      .where(
        sql`${table.consumedAt} is null and ${table.invalidatedAt} is null`,
      ),
    index('account_tokens_expires_idx').on(table.expiresAt),
  ],
);

/**
 * Trilha de auditoria do auth — append-only (Fase 7a, item 1).
 *
 * Sem chave estrangeira para `users`, pela mesma razão registrada em
 * `rate_limit_hits`: apagar o usuário não pode apagar o registro do abuso, que
 * é justamente o que se quer preservar num incidente.
 *
 * `kind` é `text` e não pgEnum — mesma escolha de `session_events.type` e
 * `outbox_events.event_type`. Tipo de evento novo não deve custar migração; a
 * união fechada mora no TypeScript (`AuthEventKind`).
 *
 * Esta tabela NÃO é a janela do lockout. Ver `auth_lockout_hits`.
 */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    // `user:<uuid>` ou `email:<hmac>` — NUNCA o e-mail em claro.
    subjectKey: text('subject_key').notNull(),
    userId: uuid('user_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('auth_events_subject_idx').on(table.subjectKey, table.occurredAt),
    index('auth_events_kind_idx').on(table.kind, table.occurredAt),
    index('auth_events_occurred_idx').on(table.occurredAt),
  ],
);

/**
 * Janela deslizante do lockout progressivo — Fase 7a, item 2.
 *
 * ## Por que não conta dentro de auth_events
 *
 * Porque `auth_events` é append-only por regra do CLAUDE.md, e zerar o contador
 * num login bem-sucedido exige DELETE. Numa tabela só, seria preciso inventar
 * uma marca d'água ("falhas desde o último sucesso") que acopla o plano de
 * consulta do throttle ao conjunto de índices da auditoria, para sempre.
 *
 * Separadas, cada uma tem a regra que lhe cabe: esta é estado efêmero de
 * contador — igual a `rate_limit_hits`, e apagável — e aquela é história.
 * As retenções também são opostas: aqui, IP e chave derivada de e-mail viram
 * passivo de PII depois de uma hora; lá, o registro precisa sobreviver.
 *
 * ## Por que a chave é o e-mail, e não o id do usuário
 *
 * Com `user:<uuid>` o balde só existiria depois de encontrar a conta —
 * tentativa contra e-mail inexistente nunca seria contada nem bloqueada, e o
 * PRÓPRIO lockout viraria oráculo de existência (basta comparar o
 * comportamento na sexta tentativa). Com `email:<hmac>`, conta real e conta
 * imaginária se comportam igual por construção.
 */
export const authLockoutHits = pgTable(
  'auth_lockout_hits',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // `email:<hmac>` · `ip:<endereço>` · `ipall:<endereço>` ·
    // `reset_email:<hmac>` · `reset_ip:<endereço>` · `register_ip:<endereço>`
    bucketKey: text('bucket_key').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Composto e nesta ordem, mesma razão de rate_limit_hits: a consulta é
    // sempre "quantos hits deste balde depois de T".
    index('auth_lockout_hits_bucket_idx').on(table.bucketKey, table.occurredAt),
    index('auth_lockout_hits_occurred_idx').on(table.occurredAt),
  ],
);
