import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
  type UpsertProficiencyProfile,
} from '../../../application/ports/proficiency-profile-repository.port';
import type { ProficiencyProfile } from '../../../domain/anamnese/proficiency-profile.entity';
import type { ProficiencyLevel } from '../../../domain/anamnese/proficiency-validation';
import { anamneseOptOuts, proficiencyProfiles } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzleProficiencyProfileRepository implements ProficiencyProfileRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async upsertMany(
    inputs: UpsertProficiencyProfile[],
  ): Promise<ProficiencyProfile[]> {
    if (inputs.length === 0) return [];
    const db = currentDb(this.rootDb);
    const rows = await db
      .insert(proficiencyProfiles)
      .values(inputs)
      .onConflictDoUpdate({
        target: [
          proficiencyProfiles.projectId,
          proficiencyProfiles.userId,
          proficiencyProfiles.competency,
        ],
        set: {
          level: sql`excluded.level`,
          rationale: sql`excluded.rationale`,
          evidenceEventIds: sql`excluded.evidence_event_ids`,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows.map(toEntity);
  }

  async listByProject(projectId: string): Promise<ProficiencyProfile[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(proficiencyProfiles)
      .where(eq(proficiencyProfiles.projectId, projectId))
      .orderBy(asc(proficiencyProfiles.competency));
    return rows.map(toEntity);
  }

  async listByUser(
    projectId: string,
    userId: string,
  ): Promise<ProficiencyProfile[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select()
      .from(proficiencyProfiles)
      .where(
        and(
          eq(proficiencyProfiles.projectId, projectId),
          eq(proficiencyProfiles.userId, userId),
        ),
      )
      .orderBy(asc(proficiencyProfiles.competency));
    return rows.map(toEntity);
  }

  async deleteByUser(projectId: string, userId: string): Promise<number> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .delete(proficiencyProfiles)
      .where(
        and(
          eq(proficiencyProfiles.projectId, projectId),
          eq(proficiencyProfiles.userId, userId),
        ),
      )
      .returning({ id: proficiencyProfiles.id });
    return rows.length;
  }
}

@Injectable()
export class DrizzleAnamneseOptOutRepository implements AnamneseOptOutRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async optOut(projectId: string, userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .insert(anamneseOptOuts)
      .values({ projectId, userId })
      .onConflictDoNothing();
  }

  async optIn(projectId: string, userId: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .delete(anamneseOptOuts)
      .where(
        and(
          eq(anamneseOptOuts.projectId, projectId),
          eq(anamneseOptOuts.userId, userId),
        ),
      );
  }

  async listOptedOutUserIds(projectId: string): Promise<string[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ userId: anamneseOptOuts.userId })
      .from(anamneseOptOuts)
      .where(eq(anamneseOptOuts.projectId, projectId));
    return rows.map((r) => r.userId);
  }
}

function toEntity(
  row: typeof proficiencyProfiles.$inferSelect,
): ProficiencyProfile {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    competency: row.competency,
    level: row.level as ProficiencyLevel,
    rationale: row.rationale,
    evidenceEventIds: row.evidenceEventIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
