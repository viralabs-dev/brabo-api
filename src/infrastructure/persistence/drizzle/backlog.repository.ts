import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
  type NewEpic,
  type NewStory,
  type NewTask,
} from '../../../application/ports/backlog-repository.port';
import type {
  Epic,
  Story,
  Task,
  StoryStatus,
} from '../../../domain/backlog/backlog.entity';
import type { PrGateStatus } from '../../../domain/execution/pr-gate-state-machine';
import type { FailureOrigin } from '../../../domain/agents/failure-origin';
import { epics, stories, tasks } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleEpicRepository implements EpicRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewEpic): Promise<Epic> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(epics)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        title: input.title,
        description: input.description ?? '',
      })
      .returning();
    return epicToEntity(row);
  }

  async findById(id: string): Promise<Epic | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(epics)
      .where(eq(epics.id, id))
      .limit(1);
    return row ? epicToEntity(row) : null;
  }

  async findByProject(projectId: string): Promise<Epic[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .orderBy(asc(epics.createdAt));
    return rows.map(epicToEntity);
  }
}

@Injectable()
export class DrizzleStoryRepository implements StoryRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewStory): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(stories)
      .values({
        epicId: input.epicId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        title: input.title,
        description: input.description ?? '',
        rf: input.rf ?? [],
        rnf: input.rnf ?? [],
        businessRuleIds: input.businessRuleIds ?? [],
        dod: input.dod ?? [],
        dor: input.dor ?? [],
      })
      .returning();
    return storyToEntity(row);
  }

  async findById(id: string): Promise<Story | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1);
    return row ? storyToEntity(row) : null;
  }

  async findByProject(projectId: string): Promise<Story[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(stories)
      .where(eq(stories.projectId, projectId))
      .orderBy(asc(stories.createdAt));
    return rows.map(storyToEntity);
  }

  async updateStatus(id: string, status: StoryStatus): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({ status, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }

  async updateModules(id: string, moduleIds: string[]): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({ moduleIds, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }
}

@Injectable()
export class DrizzleTaskRepository implements TaskRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewTask): Promise<Task> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(tasks)
      .values({
        storyId: input.storyId,
        title: input.title,
        description: input.description ?? '',
      })
      .returning();
    return taskToEntity(row);
  }

  async findById(id: string): Promise<Task | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return row ? taskToEntity(row) : null;
  }

  async findByStoryIds(storyIds: string[]): Promise<Task[]> {
    if (storyIds.length === 0) return [];
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.storyId, storyIds))
      .orderBy(asc(tasks.createdAt));
    return rows.map(taskToEntity);
  }

  async claimNext(
    projectId: string,
    module: string,
    agentId: string,
  ): Promise<Task | null> {
    const db = currentDb(this.rootDb);
    // UPDATE atômico: pega a próxima task `todo` de uma story `ready` cujo
    // module_ids (jsonb array) contém `module`, com FOR UPDATE SKIP LOCKED pra
    // dois devs nunca pegarem a mesma. `?` = operador jsonb "contém a chave/
    // elemento string". `FOR UPDATE OF t` é ESSENCIAL: sem ele, o lock cai
    // também na linha de `stories` do join — como várias tasks compartilham a
    // MESMA story, isso serializaria claims concorrentes pelo lock da story
    // (e SKIP LOCKED os descartaria em vez de tentar outra task), perdendo
    // claims mesmo com tasks disponíveis (bug real, achado pelo teste de
    // concorrência).
    // `db.execute` retorna as colunas cruas (snake_case), não o mapeamento
    // camelCase do Drizzle — daí o mapeamento manual abaixo.
    const result = await db.execute(sql`
      UPDATE tasks
      SET status = 'in_progress', assigned_to = ${agentId}, updated_at = now()
      WHERE id = (
        SELECT t.id FROM tasks t
        JOIN stories s ON s.id = t.story_id
        WHERE s.project_id = ${projectId}
          AND s.status = 'ready'
          AND s.module_ids ? ${module}
          AND t.status = 'todo'
          AND t.blocked = false
        ORDER BY t.created_at
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, story_id, title, description, status, assigned_to, blocked, blocked_reason, blocked_origin, gate_status, gate_correction_count, created_at, updated_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      storyId: row.story_id as string,
      title: row.title as string,
      description: row.description as string,
      status: row.status as Task['status'],
      assignedTo: (row.assigned_to as string | null) ?? null,
      blocked: row.blocked as boolean,
      blockedReason: (row.blocked_reason as string | null) ?? null,
      blockedOrigin: (row.blocked_origin as Task['blockedOrigin']) ?? null,
      gateStatus: (row.gate_status as PrGateStatus | null) ?? null,
      gateCorrectionCount: Number(row.gate_correction_count ?? 0),
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  async updateStatus(id: string, status: Task['status']): Promise<Task> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({ status, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return taskToEntity(row);
  }

  async countClaimableByModule(
    projectId: string,
    module: string,
  ): Promise<number> {
    const db = currentDb(this.rootDb);
    const result = await db.execute<{ n: string }>(sql`
      SELECT count(*) AS n FROM tasks t
      JOIN stories s ON s.id = t.story_id
      WHERE s.project_id = ${projectId}
        AND s.status = 'ready'
        AND s.module_ids ? ${module}
        AND t.status = 'todo'
        AND t.blocked = false
    `);
    return Number(result.rows[0]?.n ?? 0);
  }

  async markBlocked(
    id: string,
    reason: string,
    diagnosis: string,
    origin?: FailureOrigin,
  ): Promise<Task> {
    const db = currentDb(this.rootDb);
    const blockedReason = diagnosis ? `${reason} — ${diagnosis}` : reason;
    const [row] = await db
      .update(tasks)
      .set({
        status: 'todo',
        assignedTo: null,
        blocked: true,
        blockedReason,
        blockedOrigin: origin ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    return taskToEntity(row);
  }

  async unblock(id: string): Promise<Task> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({
        blocked: false,
        blockedReason: null,
        blockedOrigin: null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    return taskToEntity(row);
  }

  async openGate(id: string): Promise<Task> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({
        gateStatus: 'awaiting_qa',
        gateCorrectionCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    return taskToEntity(row);
  }

  async updateGateStatus(
    id: string,
    gateStatus: PrGateStatus,
    correctionCount: number,
  ): Promise<Task> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({
        gateStatus,
        gateCorrectionCount: correctionCount,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id))
      .returning();
    return taskToEntity(row);
  }
}

function epicToEntity(row: typeof epics.$inferSelect): Epic {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function storyToEntity(row: typeof stories.$inferSelect): Story {
  return {
    id: row.id,
    epicId: row.epicId,
    projectId: row.projectId,
    sessionId: row.sessionId,
    title: row.title,
    description: row.description,
    rf: row.rf,
    rnf: row.rnf,
    businessRuleIds: row.businessRuleIds,
    dod: row.dod,
    dor: row.dor,
    moduleIds: row.moduleIds,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function taskToEntity(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    storyId: row.storyId,
    title: row.title,
    description: row.description,
    status: row.status,
    assignedTo: row.assignedTo,
    blocked: row.blocked,
    blockedReason: row.blockedReason,
    blockedOrigin: row.blockedOrigin,
    gateStatus: row.gateStatus as PrGateStatus | null,
    gateCorrectionCount: row.gateCorrectionCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
