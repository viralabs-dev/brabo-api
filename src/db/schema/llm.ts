// Registro de modelos, binding em cascata, credenciais, metering e budget —
// `domain/llm`.
//
// `user_credentials` guarda chave de LLM E token de git, mas a entidade é
// `domain/llm/user-credential.entity.ts` e `domain/git` não tem equivalente —
// por isso a tabela mora aqui e não em `git.ts`.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, users, workspaces } from './iam';
import { actorKindEnum, sessions } from './sessions';

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
export const tokenUsage = pgTable(
  'token_usage',
  {
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
  },
  (table) => [
    // ADR 0076: as duas consultas do relatório de gasto leem uma JANELA
    // deslizante sobre `created_at`, e a tabela só tinha a PK. Medido a 525
    // mil linhas pelo ADR 0063: 55 ms e 38 ms por seq scan, 32 ms e 19 ms com
    // este índice, que transforma os dois planos em bitmap heap scan. O custo
    // cresce com o tamanho de `token_usage`, não com o do pedido — por isso o
    // índice é do tempo, e não de nenhuma das dimensões.
    index('token_usage_created_at_idx').on(table.createdAt),
  ],
);

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
