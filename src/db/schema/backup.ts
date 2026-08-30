// Backup e sua janela de retenção (Fase 5, ADR 0026).
//
// Único arquivo desta divisão SEM pasta correspondente em `domain/`: é infra de
// operação, sem regra de negócio própria. Enfiá-lo em `architecture.ts` ou
// `containers.ts` seria mentir sobre o agregado — um arquivo pequeno e honesto
// custa menos (ADR 0121).

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Backup (Fase 5). `daily` é toda execução; `weekly` marca a que também virou
// cópia na retenção semanal — as duas retenções são podadas separadamente.
export const backupKindEnum = pgEnum('backup_kind', ['daily', 'weekly']);

// Só dois estados terminais: o job ou subiu o objeto e registrou o tamanho, ou
// não. "em andamento" não existe aqui porque a linha só é escrita no fim.
export const backupStatusEnum = pgEnum('backup_status', ['ok', 'failed']);

/**
 * Execuções do CronJob de backup — a FONTE das métricas `brabo_backup_*`.
 *
 * Por que o resultado do backup mora no banco e não num Pushgateway: seria um
 * componente a mais, uma segunda fonte de verdade, e um lugar onde a métrica
 * sobrevive ao fato que ela descreve (a série continua publicada depois que o
 * job sumiu). Aqui o `DomainGaugesCollector`, que já roda num timer, lê esta
 * tabela e publica os gauges — e o runbook de restore ganha histórico
 * consultável de brinde.
 *
 * A linha é gravada SEMPRE, inclusive em falha: é o `status = 'failed'` que
 * transforma um backup quebrado em alerta em vez de silêncio.
 */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    kind: backupKindEnum('kind').notNull().default('daily'),
    status: backupStatusEnum('status').notNull(),
    // Nulo quando o job falhou antes de subir o objeto.
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => [
    // O collector pergunta "qual foi o último sucesso?" a cada 15 s, e o
    // restore procura a janela de UM object_key. Sem índice as duas viram seq
    // scan numa tabela que só cresce.
    index('backup_runs_last_success_idx')
      .on(table.finishedAt)
      .where(sql`${table.status} = 'ok'`),
    index('backup_runs_object_key_idx').on(table.objectKey),
  ],
);
