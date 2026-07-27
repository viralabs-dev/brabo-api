import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  AgentInstructionRepository,
  type AgentInstruction,
} from '../../../application/ports/agent-instruction-repository.port';
import { agentInstructions } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAgentInstructionRepository implements AgentInstructionRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async findByProjectAndAgent(
    projectId: string,
    agent: string,
  ): Promise<AgentInstruction | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(agentInstructions)
      .where(
        and(
          eq(agentInstructions.projectId, projectId),
          eq(agentInstructions.agent, agent),
        ),
      )
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async upsert(input: {
    projectId: string;
    agent: string;
    content: string;
  }): Promise<AgentInstruction> {
    const db = currentDb(this.rootDb);
    const existing = await this.findByProjectAndAgent(
      input.projectId,
      input.agent,
    );

    if (!existing) {
      const [row] = await db
        .insert(agentInstructions)
        .values({
          projectId: input.projectId,
          agent: input.agent,
          content: input.content,
        })
        .returning();
      return toEntity(row);
    }

    // Conteúdo idêntico: não bumpa version nem mexe no updatedAt.
    if (existing.content === input.content) {
      return existing;
    }

    const [row] = await db
      .update(agentInstructions)
      .set({
        content: input.content,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(agentInstructions.id, existing.id))
      .returning();
    return toEntity(row);
  }
}

function toEntity(
  row: typeof agentInstructions.$inferSelect,
): AgentInstruction {
  return {
    id: row.id,
    projectId: row.projectId,
    agent: row.agent,
    content: row.content,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
