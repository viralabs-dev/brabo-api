import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  PsychologistAnalysisRepository,
  type NewPsychologistAnalysis,
} from '../../../application/ports/psychologist-analysis-repository.port';
import type {
  PsychologistAnalysis,
  PsychologistAnalysisTier,
  PsychologistAnalysisTrigger,
} from '../../../domain/psychologist/psychologist-analysis.entity';
import { psychologistAnalyses } from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzlePsychologistAnalysisRepository
  implements PsychologistAnalysisRepository
{
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async create(input: NewPsychologistAnalysis): Promise<PsychologistAnalysis> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .insert(psychologistAnalyses)
      .values({
        projectId: input.projectId,
        sessionId: input.sessionId,
        tier: input.tier,
        triggeredBy: input.triggeredBy,
        supersedes: input.supersedes ?? null,
        eventCountAtAnalysis: input.eventCountAtAnalysis,
      })
      .returning();
    return toEntity(row);
  }

  async findCurrentBySession(
    sessionId: string,
  ): Promise<PsychologistAnalysis | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(psychologistAnalyses)
      .where(
        and(
          eq(psychologistAnalyses.sessionId, sessionId),
          eq(psychologistAnalyses.superseded, false),
        ),
      )
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async markSuperseded(id: string): Promise<void> {
    const db = currentDb(this.rootDb);
    await db
      .update(psychologistAnalyses)
      .set({ superseded: true })
      .where(eq(psychologistAnalyses.id, id));
  }
}

function toEntity(
  row: typeof psychologistAnalyses.$inferSelect,
): PsychologistAnalysis {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    tier: row.tier as PsychologistAnalysisTier,
    triggeredBy: row.triggeredBy as PsychologistAnalysisTrigger,
    supersedes: row.supersedes,
    superseded: row.superseded,
    eventCountAtAnalysis: row.eventCountAtAnalysis,
    createdAt: row.createdAt,
  };
}
