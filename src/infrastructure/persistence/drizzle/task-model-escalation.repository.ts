import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  TaskModelEscalationRepository,
  type TaskModelEscalation,
} from '../../../application/ports/task-model-escalation-repository.port';
import { taskModelEscalations } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleTaskModelEscalationRepository implements TaskModelEscalationRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async registrarBloqueio(
    taskId: string,
    projectId: string,
    agentId: string,
  ): Promise<TaskModelEscalation> {
    const [row] = await currentDb(this.rootDb)
      .insert(taskModelEscalations)
      .values({ taskId, projectId, agentId, limitBlocks: 1 })
      .onConflictDoUpdate({
        target: taskModelEscalations.taskId,
        set: {
          limitBlocks: sql`${taskModelEscalations.limitBlocks} + 1`,
          agentId,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async marcarEscalada(
    taskId: string,
    base: { modelId: string | null; routingPreference: string | null },
  ): Promise<void> {
    const db = currentDb(this.rootDb);
    const atual = await this.find(taskId);
    await db
      .update(taskModelEscalations)
      .set({
        limitBlocks: 0,
        escalated: true,
        // A base é a do PRIMEIRO degrau subido; os seguintes não a sobrescrevem.
        ...(atual?.escalated
          ? {}
          : {
              baseModelId: base.modelId,
              baseRoutingPreference: base.routingPreference,
            }),
        updatedAt: new Date(),
      })
      .where(eq(taskModelEscalations.taskId, taskId));
  }

  async find(taskId: string): Promise<TaskModelEscalation | null> {
    const [row] = await currentDb(this.rootDb)
      .select()
      .from(taskModelEscalations)
      .where(eq(taskModelEscalations.taskId, taskId));
    return row ?? null;
  }

  async remove(taskId: string): Promise<void> {
    await currentDb(this.rootDb)
      .delete(taskModelEscalations)
      .where(eq(taskModelEscalations.taskId, taskId));
  }
}
