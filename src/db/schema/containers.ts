// Ciclo de vida do container por projeto (ADR 0081) — `domain/containers`.
// A tabela só GRAVA estado; quem CHAMA Docker de verdade é o broker
// (`apps/broker`, ADR 0130), nunca esta tabela nem quem escreve nela.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { projects } from './iam';

// Ciclo de vida do container de um projeto (ADR 0081 — fecha o corte
// declarado da FASE 25b / ADR 0065). Esta tabela só registra estado, nunca
// comanda nada diretamente — ver o comentário em
// domain/containers/container-lifecycle.ts e o broker (ADR 0130), que é
// quem de fato fala com o daemon Docker.
export const containerLifecycleStatusEnum = pgEnum(
  'container_lifecycle_status',
  ['provisioning', 'running', 'stopped', 'failed', 'removed'],
);

/**
 * Uma linha por PROJETO (`project_id` único) — só existe UM container
 * vigente por vez, mesmo desenho de `dev_agent_states` no engine (ADR
 * 0045). Distinta de `artifact.project_image` no event log (ADR 0065):
 * aquele é a DECISÃO imutável do Arquiteto; esta é o ESTADO mutável do
 * container que (um dia) corresponde a ela — por isso `image_version`
 * aponta para a decisão em vez de duplicar `image`/`rationale`/`network`.
 */
export const projectContainers = pgTable(
  'project_containers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .unique()
      .references(() => projects.id, { onDelete: 'cascade' }),
    status: containerLifecycleStatusEnum('status')
      .notNull()
      .default('provisioning'),
    // A versão de `artifact.project_image` vigente quando esta linha
    // nasceu (RN-105) — NÃO um FK, porque a decisão vive no event log, não
    // numa tabela.
    imageVersion: integer('image_version').notNull(),
    // Id do container real no daemon Docker. NULL sempre, até um
    // orquestrador de verdade existir e passar a escrever aqui.
    containerId: text('container_id'),
    // Teto de recursos DECLARADO — espelha RecursosDoContainer do artefato
    // vigente no momento em que a linha nasceu; não é reaplicado depois.
    cpus: doublePrecision('cpus').notNull(),
    memoryMb: integer('memory_mb').notNull(),
    pidsLimit: integer('pids_limit').notNull(),
    // Só populado numa transição para `failed`.
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Quando a última transição de `status` aconteceu — não uma coluna por
    // estado (mesmo padrão simples de `dev_agent_states.updated_at`, sem
    // histórico próprio: o event log já é onde histórico imutável mora).
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('project_containers_status_idx').on(table.status)],
);
