import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  AgentAreaRepository,
  type AgentArea,
  type UpsertAreaInput,
} from '../../../application/ports/agent-area-repository.port';
import { agentAreaMembers, agentAreas } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleAgentAreaRepository implements AgentAreaRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async listByProject(projectId: string): Promise<AgentArea[]> {
    const db = currentDb(this.rootDb);
    const areas = await db
      .select()
      .from(agentAreas)
      .where(eq(agentAreas.projectId, projectId));

    if (areas.length === 0) return [];

    // UMA consulta para os membros de todas as áreas, não uma por área: são
    // poucas áreas, mas o padrão N+1 aqui viraria N+1 na tela do time.
    const membros = await db
      .select()
      .from(agentAreaMembers)
      .where(
        inArray(
          agentAreaMembers.areaId,
          areas.map((a) => a.id),
        ),
      );

    return areas.map((a) => ({
      id: a.id,
      projectId: a.projectId,
      key: a.key,
      leadAgentId: a.leadAgentId,
      maxParallel: a.maxParallel,
      members: membros.filter((m) => m.areaId === a.id).map((m) => m.agentId),
    }));
  }

  async findByKey(projectId: string, key: string): Promise<AgentArea | null> {
    const todas = await this.listByProject(projectId);
    return todas.find((a) => a.key === key) ?? null;
  }

  async upsert(input: UpsertAreaInput): Promise<AgentArea> {
    const db = currentDb(this.rootDb);

    // `maxParallel` omitido NÃO sobrescreve: o teto é decisão do usuário, e o
    // seeding roda de novo a cada ativação de execução. Sem esta guarda, um
    // `max_parallel` que o usuário subiu para 5 voltaria para 2 sozinho — o
    // produto desfazendo a decisão dele em silêncio.
    const [area] = await db
      .insert(agentAreas)
      .values({
        projectId: input.projectId,
        key: input.key,
        leadAgentId: input.leadAgentId,
        ...(input.maxParallel != null
          ? { maxParallel: input.maxParallel }
          : {}),
      })
      .onConflictDoUpdate({
        target: [agentAreas.projectId, agentAreas.key],
        set: {
          leadAgentId: input.leadAgentId,
          updatedAt: new Date(),
          ...(input.maxParallel != null
            ? { maxParallel: input.maxParallel }
            : {}),
        },
      })
      .returning();

    // Os membros são SUBSTITUÍDOS, não somados: um `module_map` novo pode ter
    // removido um módulo, e somar deixaria um agente fantasma na área.
    await db
      .delete(agentAreaMembers)
      .where(eq(agentAreaMembers.areaId, area.id));

    if (input.members.length > 0) {
      await db.insert(agentAreaMembers).values(
        input.members.map((agentId) => ({
          areaId: area.id,
          agentId,
        })),
      );
    }

    return {
      id: area.id,
      projectId: area.projectId,
      key: area.key,
      leadAgentId: area.leadAgentId,
      maxParallel: area.maxParallel,
      members: input.members,
    };
  }

  async setMaxParallel(
    projectId: string,
    key: string,
    maxParallel: number,
  ): Promise<AgentArea> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(agentAreas)
      .set({ maxParallel, updatedAt: new Date() })
      .where(and(eq(agentAreas.projectId, projectId), eq(agentAreas.key, key)))
      .returning();

    if (!row) {
      throw new NotFoundException(`Área "${key}" não existe neste projeto`);
    }

    const atual = await this.findByKey(projectId, key);
    return atual!;
  }
}
