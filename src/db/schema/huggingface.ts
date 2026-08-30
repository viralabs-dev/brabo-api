// Pull de modelo do Hugging Face Hub para dentro do Ollama (ADR 0115) —
// `domain/huggingface`.

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users, workspaces } from './iam';

// pending_confirmation → confirmed → pulling → active | failed. Mecanismo
// PRÓPRIO, deliberadamente FORA do pipeline de `proposed_actions`: aquele
// pipeline serve para um AGENTE ser fiscalizado por um humano (sessionId
// NOT NULL, resolvedPolicy vindo de permissions.json/decide()); aqui é o
// PRÓPRIO humano (owner/maintainer, já controlado pelo papel na rota) agindo
// direto em Project/Workspace Settings — não há agente para supervisionar,
// nem sessão em que a Aprovações/chat mostrariam o pedido. A segunda
// confirmação explícita (RN do produto: nunca pull automático e silencioso)
// é modelada pelos dois primeiros estados desta máquina, não pelo par
// approve/deny de `decide()`.
export const huggingFaceModelPullStatusEnum = pgEnum(
  'huggingface_model_pull_status',
  ['pending_confirmation', 'confirmed', 'pulling', 'active', 'failed'],
);

export const huggingFaceModelPullRequests = pgTable(
  'huggingface_model_pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    // "<publisher>/<modelo>" no Hugging Face Hub — o que vira
    // `hf.co/<repoId>` no `model` do `POST /api/pull` do Ollama.
    repoId: text('repo_id').notNull(),
    // Vem da busca no Hub quando o provider publica `usedStorage`; ausente
    // quando não — nunca estimado por palpite (mesma régua do ADR 0041 para
    // capability: sem prova, fica de fora em vez de inventado).
    estimatedSizeBytes: bigint('estimated_size_bytes', { mode: 'number' }),
    status: huggingFaceModelPullStatusEnum('status')
      .notNull()
      .default('pending_confirmation'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // Presente só em `failed`, e sempre com a origem no vocabulário do ADR
    // 0020 (infra | modelo | código | política) prefixada na mensagem — a
    // mesma regra permanente de nunca falhar calado.
    failedReason: text('failed_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('huggingface_pull_requests_workspace_idx').on(table.workspaceId),
  ],
);
