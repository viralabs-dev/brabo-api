// Instruções por agente e projeto, com histórico append-only —
// `domain/instructions`.

import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { projects, users } from './iam';

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
