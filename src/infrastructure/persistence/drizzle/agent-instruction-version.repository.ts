import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
  AgentInstructionVersionRepository,
  type NewAgentInstructionVersion,
} from '../../../application/ports/agent-instruction-version-repository.port';
import type { AgentInstructionVersion } from '../../../domain/instructions/agent-instruction-version.entity';
import { agentInstructionVersions } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAgentInstructionVersionRepository
  implements AgentInstructionVersionRepository
{
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(
    input: NewAgentInstructionVersion,
  ): Promise<AgentInstructionVersion> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(agentInstructionVersions)
      .values({
        projectId: input.projectId,
        agent: input.agent,
        version: input.version,
        content: input.content,
        createdBy: input.createdBy ?? null,
        sourceActionId: input.sourceActionId ?? null,
        sourceHypothesisId: input.sourceHypothesisId ?? null,
        note: input.note ?? null,
      })
      .returning();
    return toEntity(row);
  }

  async listAgentsWithHistory(projectId: string): Promise<string[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .selectDistinct({ agent: agentInstructionVersions.agent })
      .from(agentInstructionVersions)
      .where(eq(agentInstructionVersions.projectId, projectId))
      .orderBy(asc(agentInstructionVersions.agent));
    return rows.map((r) => r.agent);
  }

  async listByAgent(
    projectId: string,
    agent: string,
  ): Promise<AgentInstructionVersion[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(agentInstructionVersions)
      .where(
        and(
          eq(agentInstructionVersions.projectId, projectId),
          eq(agentInstructionVersions.agent, agent),
        ),
      )
      .orderBy(desc(agentInstructionVersions.version));
    return rows.map(toEntity);
  }

  async findVersion(
    projectId: string,
    agent: string,
    version: number,
  ): Promise<AgentInstructionVersion | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(agentInstructionVersions)
      .where(
        and(
          eq(agentInstructionVersions.projectId, projectId),
          eq(agentInstructionVersions.agent, agent),
          eq(agentInstructionVersions.version, version),
        ),
      )
      .limit(1);
    return row ? toEntity(row) : null;
  }
}

function toEntity(
  row: typeof agentInstructionVersions.$inferSelect,
): AgentInstructionVersion {
  return {
    id: row.id,
    projectId: row.projectId,
    agent: row.agent,
    version: row.version,
    content: row.content,
    createdBy: row.createdBy,
    sourceActionId: row.sourceActionId,
    sourceHypothesisId: row.sourceHypothesisId,
    note: row.note,
    createdAt: row.createdAt,
  };
}
