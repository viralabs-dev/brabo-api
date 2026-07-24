import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
