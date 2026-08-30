// Identidade e IAM — usuários, workspaces, projetos e os papéis que ligam um
// ao outro (espelha `domain/iam`).
//
// `project_execution_mode` e `story_promotion` moram AQUI, e não em `git.ts` /
// `backlog.ts`, porque `projects` é o único consumidor dos dois: enum fica com
// a tabela que o chama, senão o grafo de módulos ganha um ciclo em que o enum
// é avaliado antes de existir (ADR 0121).

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  timestamp,
  primaryKey,
  unique,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Vocabulário de papel único, compartilhado entre workspace_members e
// project_members — o papel de projeto sobrepõe o de workspace (ver
// RolesService), então os dois precisam falar a mesma linguagem.
export const roleEnum = pgEnum('role', [
  'owner',
  'maintainer',
  'developer',
  'viewer',
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

// ONDE o comando de um projeto EXECUTA (RN-169/RN-421, ADR 0072/0104).
// `container` (default): a pasta gerenciada em PROJECT_WORKSPACES_ROOT — o
// comportamento que sempre existiu, e por isso o default; projeto criado
// antes desta coluna não muda de lugar.
// `mounted` (antigo `local`, renomeado pelo ADR 0104): uma pasta do
// USUÁRIO, caminho absoluto livre, que só funciona montada nos containers
// da api e do engine (RN-170/RN-422).
// `runner`: uma pasta do usuário que NÃO precisa de bind-mount — o CLI
// `brabo-runner` roda na máquina do usuário e confirma o caminho quando
// conecta (RN-423). O projeto nasce com `workspace_verified_at` nulo e é
// promovido quando a confirmação chega.
// CUIDADO com o homônimo: nenhum destes três valores tem relação com o
// `GitProviderName` `'local'` (git-provider.ts) — são eixos diferentes,
// um decide ONDE O COMANDO EXECUTA, o outro decide QUEM HOSPEDA O GIT.
export const projectExecutionModeEnum = pgEnum('project_execution_mode', [
  'container',
  'mounted',
  'runner',
]);

// Idioma da interface (fundação de i18n, Onda 6a). Fechado a dois valores de
// propósito — abrir para qualquer BCP-47 exigiria arquivo de recurso e
// validação de fallback que a extração de strings (etapa separada) ainda não
// tem. `pt-BR` é o default: nunca flipar silenciosamente quem já tem conta.
export const userLocaleEnum = pgEnum('user_locale', ['pt-BR', 'en']);

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
    // Preferência de idioma (fundação de i18n, Onda 6a) — default 'pt-BR'
    // para NUNCA flipar silenciosamente quem já tem conta; usuário sem conta
    // ainda usa `navigator.language` só como sugestão de EXIBIÇÃO, nunca
    // persistida (ver `apps/web/src/lib/idioma.ts`).
    locale: userLocaleEnum('locale').notNull().default('pt-BR'),
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
    // O nome da pasta física em PROJECT_WORKSPACES_ROOT — CONGELADO na
    // criação do projeto e nunca recalculado (RN-109, ver
    // project-workspaces-root.ts). Projeto novo nasce com
    // `<slug>-<8 chars do id>` (legível); projeto que já existia antes desta
    // coluna foi retroativado com o UUID puro, que é o que já era verdade no
    // disco — o backfill da migração NÃO renomeia diretório nenhum.
    workspaceDirName: text('workspace_dir_name').notNull().unique(),
    // ONDE o comando deste projeto EXECUTA (RN-169/RN-421, ADR 0072/0104).
    // NOT NULL com default `container` — o comportamento de sempre —, pelo
    // mesmo motivo de `story_promotion` logo abaixo: o valor É a decisão, e
    // decisão de onde o agente escreve não fica implícita.
    executionMode: projectExecutionModeEnum('execution_mode')
      .notNull()
      .default('container'),
    // O caminho absoluto da pasta do usuário, para `mounted` OU `runner`.
    // Em `mounted`, validado NA CRIAÇÃO (RN-422) — existe, é gravável de
    // dentro do container, não é raiz de sistema nem contém o repositório
    // do Brabo. Em `runner`, só a parte LÉXICA é validada na criação; o
    // runner é quem confirma o resto quando conecta (RN-423) — e pode
    // SOBRESCREVER este valor com o caminho real do host.
    workspacePath: text('workspace_path'),
    // NULL = não verificado. Só ganha sentido em `execution_mode: runner`
    // — `container`/`mounted` nunca preenchem esta coluna (RN-423). Vira
    // timestamp quando o primeiro runner conecta e confirma o caminho.
    workspaceVerifiedAt: timestamp('workspace_verified_at', {
      withTimezone: true,
    }),
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
  (table) => [
    unique().on(table.workspaceId, table.slug),
    // Modo e caminho são UMA decisão, não duas: `mounted`/`runner` sem
    // caminho é escopo de terminal apontando para lugar nenhum, e
    // `container` COM caminho é uma segunda fonte de verdade esperando
    // divergir da primeira. A trava fica no banco, e não só no caso de uso,
    // porque a coluna é lida por DOIS processos (api e engine) e escrita
    // por scripts de seed/backfill que não passam pelo caso de uso.
    check(
      'projects_workspace_path_casa_com_modo',
      sql`(${table.executionMode} <> 'container') = (${table.workspacePath} IS NOT NULL)`,
    ),
  ],
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
