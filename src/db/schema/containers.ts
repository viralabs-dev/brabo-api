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
  jsonb,
  timestamp,
  index,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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

// AT-612 (ADR 0229, RN-935): a instância de QA efêmera de uma TAREFA. Uma
// linha por (projeto, tarefa); o teto de 1 ativa por projeto é regra do caso de
// uso, sob lock da linha do projeto. `task_id` é texto: a tarefa mora em
// outra tabela e a instância sobrevive à linha dela no log.
export const qaEnvironmentStatusEnum = pgEnum('qa_environment_status', [
  'provisioning',
  'running',
  'failed',
  'removed',
]);

export const projectQaEnvironments = pgTable(
  'project_qa_environments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    status: qaEnvironmentStatusEnum('status').notNull().default('provisioning'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique('project_qa_environments_project_task_uq').on(t.projectId, t.taskId),
    // O teto de 1 instância ativa por projeto, no banco (RN-935).
    uniqueIndex('project_qa_environments_one_active_idx')
      .on(t.projectId)
      .where(sql`${t.status} in ('provisioning', 'running')`),
  ],
);

// AT-980 (ADR 0298, RN-1382): o inventário do que a api PEDIU ao broker, e o
// resultado. De propósito SEM FK com `cascade` para `projects`: sobrevive ao
// projeto apagado, que é quando a limpeza pendente (`removendo`) precisa dele.
export const recursoDeProjetoTipoEnum = pgEnum('recurso_de_projeto_tipo', [
  'container',
  'container_qa',
]);
export const recursoDeProjetoEstadoEnum = pgEnum('recurso_de_projeto_estado', [
  'pedido',
  'criado',
  'falhou',
  'removendo',
  'removido',
]);

export const projectResources = pgTable(
  'project_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    // RN-1439: gravados ao apagar o projeto (que já não existe para dizer quem era).
    workspaceId: uuid('workspace_id'),
    projetoNome: text('projeto_nome'),
    tipo: recursoDeProjetoTipoEnum('tipo').notNull(),
    // Chave da instância de QA; '' no container de trabalho (única por tipo).
    chave: text('chave').notNull().default(''),
    // Portas pedidas (a rede vigente na hora do pedido).
    portas: jsonb('portas')
      .notNull()
      .default(sql`'[]'::jsonb`),
    containerId: text('container_id'),
    estado: recursoDeProjetoEstadoEnum('estado').notNull().default('pedido'),
    motivo: text('motivo'),
    tentativas: integer('tentativas').notNull().default(0),
    criadoEm: timestamp('criado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('project_resources_estado_idx').on(t.estado),
    unique('project_resources_projeto_tipo_chave_uq').on(
      t.projectId,
      t.tipo,
      t.chave,
    ),
  ],
);
