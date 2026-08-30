// Artefatos do Arquiteto que viraram tabela — `domain/architecture`. O que é
// artefato versionado de sessão (imagem do projeto, diagrama C4) continua sem
// tabela, no event log.

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { projects } from './iam';
import { sessions } from './sessions';

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
