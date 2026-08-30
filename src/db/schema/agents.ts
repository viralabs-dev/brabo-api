// Agentes: autonomia por tipo de ação, áreas com lead único e delegação
// interna — `domain/agents`.
//
// `failure_origin` mora em `backlog.ts` porque é compartilhado com
// `tasks.blocked_origin`, e este arquivo já depende daquele
// (`delegations.task_id`) — o inverso fecharia um ciclo (ADR 0121).

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
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { permissionPolicyEnum } from './actions';
import { failureOriginEnum, tasks } from './backlog';
import { projects } from './iam';
import { sessions } from './sessions';

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
 *
 * `budgetMicros`/`spentMicros` (ADR 0110, RN-443) fecham o "budget por área"
 * do backlog do ADR 0038, mirando exatamente `maxParallel`: teto do USUÁRIO,
 * default vazio (sem teto), direto na linha da área — não a tabela genérica
 * `budgets` (cujo CHECK de mutual exclusion projeto/sessão não tem onde
 * encaixar um terceiro escopo) nem uma tabela nova. `spentMicros` acumula
 * SEMPRE que um agente da área gasta, com ou sem `budgetMicros` definido —
 * é o que permite mostrar o gasto real da área antes mesmo de alguém
 * configurar um teto.
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
    /** `null` = sem teto. Em micro-USD, mesma unidade de `budgets.limit_micros`. */
    budgetMicros: bigint('budget_micros', { mode: 'number' }),
    spentMicros: bigint('spent_micros', { mode: 'number' })
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
    unique().on(table.projectId, table.key),
    check(
      'agent_areas_budget_micros_check',
      sql`${table.budgetMicros} is null or ${table.budgetMicros} >= 0`,
    ),
    check('agent_areas_spent_micros_check', sql`${table.spentMicros} >= 0`),
  ],
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
