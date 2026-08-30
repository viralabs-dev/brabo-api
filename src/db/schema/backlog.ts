// Backlog (Fase 3b — PO): épicos → histórias → tarefas — `domain/backlog`.
//
// `failure_origin` mora aqui: `tasks.blocked_origin` e
// `delegations.failure_origin` compartilham o enum, e `agents.ts` já importa
// deste arquivo (`delegations.task_id`) — colocá-lo lá criaria ciclo.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects } from './iam';
import { sessions } from './sessions';

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
