import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
  InfraArtifactRepository,
  type NewInfraArtifact,
} from '../../../application/ports/infra-artifact-repository.port';
import type { InfraArtifact } from '../../../domain/execution/infra-artifact.entity';
import type { PrGateStatus } from '../../../domain/execution/pr-gate-state-machine';
import { infraArtifacts } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleInfraArtifactRepository implements InfraArtifactRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewInfraArtifact): Promise<InfraArtifact> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(infraArtifacts)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        title: input.title,
        prActionId: input.prActionId,
      })
      .returning();
    return toEntity(row);
  }

  async findById(id: string): Promise<InfraArtifact | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(infraArtifacts)
      .where(eq(infraArtifacts.id, id))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async findByPrActionId(prActionId: string): Promise<InfraArtifact | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(infraArtifacts)
      .where(eq(infraArtifacts.prActionId, prActionId))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async findBySessionId(sessionId: string): Promise<InfraArtifact | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(infraArtifacts)
      .where(eq(infraArtifacts.sessionId, sessionId))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async listByProject(projectId: string): Promise<InfraArtifact[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(infraArtifacts)
      .where(eq(infraArtifacts.projectId, projectId))
      .orderBy(desc(infraArtifacts.createdAt));
    return rows.map(toEntity);
  }

  async updateGateStatus(
    id: string,
    gateStatus: PrGateStatus,
    correctionCount: number,
  ): Promise<InfraArtifact> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(infraArtifacts)
      .set({
        gateStatus,
        gateCorrectionCount: correctionCount,
        updatedAt: new Date(),
      })
      .where(eq(infraArtifacts.id, id))
      .returning();
    return toEntity(row);
  }

  async markBlocked(
    id: string,
    reason: string,
    diagnosis: string,
  ): Promise<InfraArtifact> {
    const db = currentDb(this.rootDb);
    const blockedReason = diagnosis ? `${reason} — ${diagnosis}` : reason;
    const [row] = await db
      .update(infraArtifacts)
      .set({ blocked: true, blockedReason, updatedAt: new Date() })
      .where(eq(infraArtifacts.id, id))
      .returning();
    return toEntity(row);
  }
}

function toEntity(row: typeof infraArtifacts.$inferSelect): InfraArtifact {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    title: row.title,
    prActionId: row.prActionId,
    gateStatus: row.gateStatus as PrGateStatus,
    gateCorrectionCount: row.gateCorrectionCount,
    blocked: row.blocked,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
