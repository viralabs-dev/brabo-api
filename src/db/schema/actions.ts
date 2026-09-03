// Pipeline de ações propostas — `domain/actions`. Toda ação com efeito externo
// nasce aqui e respeita permissions.json (CLAUDE.md).

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigserial,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { GitBootstrapExecutionResult } from '../../domain/git/bootstrap-execution-result';
import type { AdrPrExecutionResult } from '../../domain/git/adr-pr-execution-result';
import type { GitActionExecutionResult } from '../../domain/git/git-action-execution-result';
import type { InfraPrExecutionResult } from '../../domain/git/infra-pr-execution-result';
import type { InstructionPatchExecutionResult } from '../../domain/instructions/instruction-patch-execution-result';
import type { ContainerStartExecutionResult } from '../../domain/containers/container-start-execution-result';
import { projects, users } from './iam';
import { actorKindEnum, sessions } from './sessions';

// pending → approved | denied; approved/auto_approved → executed | failed
// (ver domain/actions/action-state-machine.ts). "denied" cobre tanto
// recusa manual quanto deny automático da política.
export const actionStatusEnum = pgEnum('action_status', [
  'pending',
  'approved',
  'denied',
  'auto_approved',
  'executed',
  'failed',
]);

// Vocabulário compartilhado por resolved_policy (escalar) e por
// agent_autonomy.mode — o mesmo enum, já que os dois participam da mesma
// decisão em domain/actions/decide.ts.
export const permissionPolicyEnum = pgEnum('permission_policy', [
  'auto_approve',
  'require_approval',
  'deny',
]);

export const proposedActions = pgTable(
  'proposed_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    // Cursor de paginação monotônico global — bigserial, NÃO gapless por
    // sessão (contraste deliberado com session_events.seq): não há
    // requisito de negócio de "sem gaps" pra ações propostas.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    // 'terminal' | 'git_commit' | 'git_push' | 'pr_open' | 'spend' —
    // validado na borda (DTO), não como enum de banco (mesmo tratamento já
    // dado a session_events.type).
    actionType: text('action_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: actionStatusEnum('status').notNull().default('pending'),
    resolvedPolicy: permissionPolicyEnum('resolved_policy').notNull(),
    actorKind: actorKindEnum('actor_kind').notNull(), // quem propôs
    actorId: text('actor_id').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    // Preenchido só depois de executed/failed.
    executionResult: jsonb('execution_result').$type<
      | TerminalExecutionResult
      | GitBootstrapExecutionResult
      | AdrPrExecutionResult
      | GitActionExecutionResult
      | InfraPrExecutionResult
      | InstructionPatchExecutionResult
      | ContainerStartExecutionResult
    >(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('proposed_actions_session_seq_idx').on(table.sessionId, table.seq),
  ],
);
