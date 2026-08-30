// Anamnese (Fase 4b) — `domain/anamnese`. PAUSADA desde 2026-08-10
// (`ANAMNESE_ENABLED=false`).

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { projects, users } from './iam';
import { psychologistHypotheses } from './psychologist';
import { sessions } from './sessions';

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
