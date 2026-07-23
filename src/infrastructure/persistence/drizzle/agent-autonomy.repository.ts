import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AgentAutonomyRepository } from '../../../application/ports/agent-autonomy-repository.port';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import { agentAutonomy } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAgentAutonomyRepository implements AgentAutonomyRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findMode(
    projectId: string,
    agentId: string,
    actionType: string,
  ): Promise<PermissionPolicy | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select({ mode: agentAutonomy.mode })
      .from(agentAutonomy)
      .where(
        and(
          eq(agentAutonomy.projectId, projectId),
          eq(agentAutonomy.agentId, agentId),
          eq(agentAutonomy.actionType, actionType),
        ),
      );
    return row?.mode ?? null;
  }

  async upsert(
    projectId: string,
    agentId: string,
    actionType: string,
    mode: PermissionPolicy,
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .insert(agentAutonomy)
      .values({ projectId, agentId, actionType, mode })
      .onConflictDoUpdate({
        target: [
          agentAutonomy.projectId,
          agentAutonomy.agentId,
          agentAutonomy.actionType,
        ],
        set: { mode, updatedAt: new Date() },
      });
  }

  async listForProject(projectId: string) {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        agentId: agentAutonomy.agentId,
        actionType: agentAutonomy.actionType,
        mode: agentAutonomy.mode,
      })
      .from(agentAutonomy)
      .where(eq(agentAutonomy.projectId, projectId));
    return rows;
  }
}
