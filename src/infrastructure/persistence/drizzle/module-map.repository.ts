import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  ModuleMapRepository,
  type NewModuleMap,
} from '../../../application/ports/module-map-repository.port';
import type { ModuleMap } from '../../../domain/architecture/module-map.entity';
import { moduleMaps } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleModuleMapRepository implements ModuleMapRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewModuleMap): Promise<ModuleMap> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(moduleMaps)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        modules: input.modules,
        version: input.version,
      })
      .returning();
    return toEntity(row);
  }

  async findCurrent(projectId: string): Promise<ModuleMap | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(moduleMaps)
      .where(eq(moduleMaps.projectId, projectId))
      .orderBy(desc(moduleMaps.version))
      .limit(1);
    return row ? toEntity(row) : null;
  }
}

function toEntity(row: typeof moduleMaps.$inferSelect): ModuleMap {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    modules: row.modules,
    version: row.version,
    createdAt: row.createdAt,
  };
}
