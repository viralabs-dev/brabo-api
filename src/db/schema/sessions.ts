// Sessões e o event log — `domain/sessions`.
//
// `handoffs` mora aqui, e não em `agents.ts`, porque a entidade é de sessão
// (`domain/sessions/handoff.entity.ts`): o handoff só existe dentro de uma.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, users } from './iam';

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

export const socketTicketScopeEnum = pgEnum('socket_ticket_scope', [
  'heartbeat',
  'terminal',
]);

/**
 * Ticket opaco de uso único pra autenticar `connect/3` do socket Phoenix da
 * sessão (RN-108) — fecha o gap descrito no moduledoc de
 * `EngineWeb.SessionSocket`: antes desta tabela, qualquer um que descobrisse
 * um `session_id` (UUID) entrava no canal e recebia os broadcasts ao vivo.
 *
 * NÃO é o JWT reaproveitado: TTL de 30s, uso único, e escopo fechado
 * (`heartbeat` | `terminal`) — o mesmo papel mínimo de
 * `MIN_ROLE_FOR_ACTION_TYPE.terminal` em `domain/actions/decide.ts` decide
 * quem pode pedir escopo `terminal`.
 *
 * `ticketHash` é SHA-256 PURO do token bruto (`node:crypto` `createHash`),
 * não `hashDeToken` (HMAC com pepper). A verificação roda no ENGINE, que lê
 * esta tabela direto (mesmo padrão de `outbox_events` — ver
 * `Engine.Outbox.Event`) e não tem acesso ao pepper derivado de
 * `AUTH_TOKEN_PEPPER`/`AUTH_JWT_SECRET`: exigir isso duplicaria segredo de
 * auth entre os dois serviços só para verificar um token de 256 bits de
 * CSPRNG que, como o próprio `hashDeToken` já registra, não tem dicionário
 * possível — o pepper não protegeria nada aqui que a entropia do token não já
 * proteja sozinha.
 */
export const sessionSocketTickets = pgTable(
  'session_socket_tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: socketTicketScopeEnum('scope').notNull(),
    ticketHash: text('ticket_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Consumo de uso único — engine marca atomicamente (UPDATE condicional,
    // mesmo padrão de `account_tokens.consumed_at`). Reuso tem que achar a
    // linha já marcada e falhar.
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('session_socket_tickets_hash_idx').on(table.ticketHash),
    index('session_socket_tickets_session_idx').on(table.sessionId),
    // A poda apaga por tempo — mesmo padrão de refresh_tokens_expires_idx.
    index('session_socket_tickets_expires_idx').on(table.expiresAt),
  ],
);
