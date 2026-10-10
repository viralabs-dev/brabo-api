import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  EpicRepository,
  StoryRepository,
  TaskRepository,
  type NewEpic,
  type NewStory,
  type StoryContent,
  type NewTask,
  type TarefaPendenteDaExecucao,
} from '../../../application/ports/backlog-repository.port';
import type {
  Epic,
  Story,
  Task,
  StoryStatus,
} from '../../../domain/backlog/backlog.entity';
import type { PrGateStatus } from '../../../domain/execution/pr-gate-state-machine';
import type { FailureOrigin } from '../../../domain/agents/failure-origin';
import { epics, projects, stories, tasks } from '../../../db/schema';
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
      // RN-727: arquivada sai do backlog e, por esta leitura, da cobertura.
      .where(and(eq(stories.projectId, projectId), isNull(stories.archivedAt)))
      .orderBy(asc(stories.createdAt));
    return rows.map(storyToEntity);
  }

  async updateText(
    id: string,
    text: { title: string; description: string },
  ): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({ ...text, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }

  async archive(id: string, reason: string | null): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({
        // Sai também da fila de promoção na MESMA escrita (RN-048/RN-727).
        proposedReady: false,
        archivedAt: new Date(),
        archivedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
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

  async updateContent(id: string, content: StoryContent): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({ ...content, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }

  async setProposedReady(id: string, proposed: boolean): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({ proposedReady: proposed, updatedAt: new Date() })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }

  async markReturned(id: string, reason: string): Promise<Story> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(stories)
      .set({
        // Sai da fila de proposta NA MESMA escrita em que a recusa é
        // gravada: separar as duas deixaria uma janela em que a story
        // aparece como "aguardando decisão" e já foi decidida.
        proposedReady: false,
        returnedReason: reason,
        returnedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stories.id, id))
      .returning();
    return storyToEntity(row);
  }

  async listProposedReady(projectId: string): Promise<Story[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(stories)
      .where(
        and(
          eq(stories.projectId, projectId),
          eq(stories.proposedReady, true),
          isNull(stories.archivedAt),
        ),
      )
      .orderBy(asc(stories.createdAt));
    return rows.map(storyToEntity);
  }
}

@Injectable()
export class DrizzleTaskRepository implements TaskRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  // RN-776: a sessão só responde se for a de execução VIGENTE do projeto — a
  // `active` mais recente com `execution.activated`, a mesma régua de
  // `DrizzleSessionRepository.findActiveExecutionSession`.
  async findPendenteDaExecucao(
    sessionId: string,
  ): Promise<TarefaPendenteDaExecucao | null> {
    const db = currentDb(this.rootDb);
    const result = await db.execute(sql`
      WITH vigente AS (
        SELECT s.id, s.project_id
          FROM sessions s
          JOIN sessions alvo ON alvo.id = ${sessionId}
                            AND alvo.project_id = s.project_id
         WHERE s.status = 'active'
           AND EXISTS (SELECT 1 FROM session_events e
                        WHERE e.session_id = s.id
                          AND e.type = 'execution.activated')
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT 1
      )
      SELECT t.id AS task_id,
             CASE
               WHEN t.blocked THEN 'bloqueada'
               WHEN t.gate_status = 'awaiting_user' THEN 'aguardando_merge'
               ELSE 'conflito_de_merge'
             END AS motivo
        FROM tasks t
        JOIN stories st ON st.id = t.story_id AND st.archived_at IS NULL
        JOIN vigente v ON v.project_id = st.project_id AND v.id = ${sessionId}
       WHERE t.status <> 'done'
         AND (
           t.blocked
           OR t.gate_status = 'awaiting_user'
           OR (t.status = 'in_progress' AND EXISTS (
                SELECT 1 FROM session_events e
                 WHERE e.session_id = v.id
                   AND e.type = 'backlog.task_merge_conflict'
                   AND e.payload->>'taskId' = t.id::text))
         )
       ORDER BY t.blocked DESC, t.created_at ASC
       LIMIT 1
    `);
    const row = result.rows[0] as
      | { task_id: string; motivo: TarefaPendenteDaExecucao['motivo'] }
      | undefined;
    return row ? { taskId: row.task_id, motivo: row.motivo } : null;
  }

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

  async findByProjectAndIdPrefix(
    projectId: string,
    idPrefix: string,
  ): Promise<Task | null> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(stories, eq(stories.id, tasks.storyId))
      .where(
        and(
          eq(stories.projectId, projectId),
          sql`${tasks.id}::text LIKE ${`${idPrefix}-%`}`,
        ),
      )
      .limit(1);
    return rows[0] ? taskToEntity(rows[0].task) : null;
  }

  async findInProjectByIds(projectId: string, ids: string[]): Promise<Task[]> {
    if (ids.length === 0) return [];
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(stories, eq(stories.id, tasks.storyId))
      .where(
        and(
          eq(stories.projectId, projectId),
          inArray(tasks.id, ids),
          // RN-727: tarefa de história arquivada não entra no plano.
          isNull(stories.archivedAt),
        ),
      );
    return rows.map((r) => taskToEntity(r.task));
  }

  async assignModules(
    assignments: ReadonlyArray<{ taskId: string; module: string }>,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    for (const { taskId, module } of assignments) {
      await db
        .update(tasks)
        .set({ module, updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
    }
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
          AND s.archived_at IS NULL
          AND ${daTarefaDoModulo(module)}
          AND t.status = 'todo'
          AND t.blocked = false
        ORDER BY t.created_at
        FOR UPDATE OF t SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, story_id, title, description, status, assigned_to, blocked, blocked_reason, blocked_origin, gate_status, gate_correction_count, module, created_at, updated_at
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
      module: (row.module as string | null) ?? null,
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

  async markDoneIfNotDone(id: string): Promise<Task | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({ status: 'done', updatedAt: new Date() })
      .where(and(eq(tasks.id, id), ne(tasks.status, 'done')))
      .returning();
    return row ? taskToEntity(row) : null;
  }

  async reabrirPorConflitoDeMerge(id: string): Promise<Task | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(tasks)
      .set({
        status: 'in_progress',
        gateStatus: null,
        gateCorrectionCount: 0,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, id), eq(tasks.status, 'in_review')))
      .returning();
    return row ? taskToEntity(row) : null;
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
        AND s.archived_at IS NULL
        AND ${daTarefaDoModulo(module)}
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

  async countBlockedByWorkspace(
    workspaceId: string,
  ): Promise<{ projectId: string; total: number }[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        projectId: stories.projectId,
        total: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .innerJoin(stories, eq(tasks.storyId, stories.id))
      .innerJoin(projects, eq(projects.id, stories.projectId))
      .where(
        and(eq(tasks.blocked, true), eq(projects.workspaceId, workspaceId)),
      )
      .groupBy(stories.projectId);
    return rows.map((row) => ({ projectId: row.projectId, total: row.total }));
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
    proposedReady: row.proposedReady,
    returnedReason: row.returnedReason,
    returnedAt: row.returnedAt,
    archivedAt: row.archivedAt,
    archivedReason: row.archivedReason,
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
    module: row.module,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * QUAL tarefa é do dev de `module` (AT-274, RN-678) — o MESMO predicado no
 * claim e na contagem que sugere paralelização, para os dois nunca
 * discordarem. A tarefa com módulo (atribuído pelo Dev Lead no plano aprovado)
 * é de quem tem aquele módulo, e de mais ninguém: os `module_ids` da story
 * deixam de decidir, porque uma story com dois módulos deixava qualquer um dos
 * dois devs pegar qualquer tarefa (uso real de 29/09). A tarefa SEM módulo só
 * é pegável quando a story tem UM módulo, e é este — aí "o dev daquele módulo"
 * não é ambíguo, e é o caminho de quem ativou pela Visão Geral sem plano.
 * Tarefa sem módulo de story com vários espera o próximo plano.
 */
function daTarefaDoModulo(module: string) {
  return sql`(t.module = ${module} OR (t.module IS NULL AND jsonb_array_length(s.module_ids) = 1 AND s.module_ids ? ${module}))`;
}
