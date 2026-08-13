import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AgentAutonomyRepository } from '../../../application/ports/agent-autonomy-repository.port';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import { AGENT_AUTONOMY_ALL_ACTIONS } from '../../../domain/actions/decide';
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
    // Busca a regra ESPECÍFICA e a regra CURINGA (`*`, "auto mode" — RN-153)
    // numa query só: uma linha por `actionType` distinto (a unique constraint
    // do schema garante no máximo duas linhas aqui). A específica sempre
    // vence — é o que deixa "auto mode ligado, mas este tipo em deny" fazer o
    // que a frase diz.
    const rows = await db
      .select({
        actionType: agentAutonomy.actionType,
        mode: agentAutonomy.mode,
      })
      .from(agentAutonomy)
      .where(
        and(
          eq(agentAutonomy.projectId, projectId),
          eq(agentAutonomy.agentId, agentId),
          inArray(agentAutonomy.actionType, [
            actionType,
            AGENT_AUTONOMY_ALL_ACTIONS,
          ]),
        ),
      );
    const especifica = rows.find((r) => r.actionType === actionType);
    if (especifica) return especifica.mode;
    const curinga = rows.find(
      (r) => r.actionType === AGENT_AUTONOMY_ALL_ACTIONS,
    );
    return curinga?.mode ?? null;
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
