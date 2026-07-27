import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, isNotNull, lt } from 'drizzle-orm';
import {
  ProposedActionRepository,
  type DecideProposedAction,
  type ExecutionResultUpdate,
  type ListProposedActionsOptions,
  type NewProposedAction,
  type Page,
} from '../../../application/ports/proposed-action-repository.port';
import type { ProposedAction } from '../../../domain/actions/proposed-action.entity';
import { proposedActions } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class DrizzleProposedActionRepository implements ProposedActionRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewProposedAction): Promise<ProposedAction> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(proposedActions)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        actionType: input.actionType,
        payload: input.payload,
        status: input.status,
        resolvedPolicy: input.resolvedPolicy,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        rejectionReason: input.rejectionReason ?? null,
      })
      .returning();
    return toEntity(row);
  }

  async findInSessionForUpdate(
    sessionId: string,
    actionId: string,
  ): Promise<ProposedAction | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.id, actionId),
          eq(proposedActions.sessionId, sessionId),
        ),
      )
      .for('update');
    return row ? toEntity(row) : null;
  }

  async updateDecision(
    actionId: string,
    input: DecideProposedAction,
  ): Promise<ProposedAction> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(proposedActions)
      .set({
        status: input.status,
        decidedBy: input.decidedBy,
        decidedAt: input.decidedAt,
        rejectionReason: input.rejectionReason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(proposedActions.id, actionId))
      .returning();
    return toEntity(row);
  }

  async updateExecutionResult(
    actionId: string,
    input: ExecutionResultUpdate,
  ): Promise<ProposedAction> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(proposedActions)
      .set({
        status: input.status,
        executionResult: input.executionResult,
        updatedAt: new Date(),
      })
      .where(eq(proposedActions.id, actionId))
      .returning();
    return toEntity(row);
  }

  async listPaginated(
    sessionId: string,
    opts: ListProposedActionsOptions,
  ): Promise<Page<ProposedAction>> {
    const db = currentDb(this.rootDb);
    const limit = Math.min(opts.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const conditions = [eq(proposedActions.sessionId, sessionId)];
    if (opts.afterSeq !== undefined) {
      conditions.push(gt(proposedActions.seq, opts.afterSeq));
    }

    const rows = await db
      .select()
      .from(proposedActions)
      .where(and(...conditions))
      .orderBy(asc(proposedActions.seq))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toEntity),
      nextCursor: hasMore ? page[page.length - 1].seq : null,
    };
  }

  async listDecidedInWindow(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<ProposedAction[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.projectId, projectId),
          // `decidedBy` não-nulo é O critério: separa decisão HUMANA de
          // recusa de política (que também grava status 'denied', mas sem
          // decisor) e de auto-aprovação.
          //
          // Sem filtro por status de propósito: uma ação aprovada que EXECUTOU
          // fica com status 'executed'/'failed', não 'approved' — filtrar por
          // 'approved' escondia justamente as aprovações que viraram algo.
          isNotNull(proposedActions.decidedBy),
          isNotNull(proposedActions.decidedAt),
          gte(proposedActions.decidedAt, from),
          lt(proposedActions.decidedAt, to),
        ),
      )
      .orderBy(asc(proposedActions.decidedAt));
    return rows.map(toEntity);
  }

  async listByProjectAndType(
    projectId: string,
    actionType: string,
  ): Promise<ProposedAction[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(proposedActions)
      .where(
        and(
          eq(proposedActions.projectId, projectId),
          eq(proposedActions.actionType, actionType),
        ),
      )
      .orderBy(asc(proposedActions.seq));
    return rows.map(toEntity);
  }
}

function toEntity(row: typeof proposedActions.$inferSelect): ProposedAction {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    seq: row.seq,
    actionType: row.actionType,
    payload: row.payload,
    status: row.status,
    resolvedPolicy: row.resolvedPolicy,
    actor: { kind: row.actorKind, id: row.actorId },
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    rejectionReason: row.rejectionReason,
    executionResult: row.executionResult,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
