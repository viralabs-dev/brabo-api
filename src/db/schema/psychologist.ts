// Psicólogo (Fase 4b) — `domain/psychologist`. PAUSADO desde 2026-08-10; as
// tabelas continuam porque o histórico já gravado não some com a pausa.

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, users } from './iam';
import { sessions } from './sessions';

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
