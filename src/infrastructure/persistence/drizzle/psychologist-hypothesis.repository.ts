import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  PsychologistHypothesisRepository,
  type NewPsychologistHypothesis,
} from '../../../application/ports/psychologist-hypothesis-repository.port';
import type { PsychologistHypothesis } from '../../../domain/psychologist/psychologist-hypothesis.entity';
import type { HypothesisStatus } from '../../../domain/psychologist/hypothesis-lifecycle';
import {
  psychologistAnalyses,
  psychologistHypotheses,
} from '../../../db/schema';
import { DRIZZLE, type DrizzleDb } from './drizzle-client';
import { currentDb } from './drizzle-context';

@Injectable()
export class DrizzlePsychologistHypothesisRepository implements PsychologistHypothesisRepository {
  constructor(@Inject(DRIZZLE) private readonly rootDb: DrizzleDb) {}

  async createMany(
    inputs: NewPsychologistHypothesis[],
  ): Promise<PsychologistHypothesis[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .insert(psychologistHypotheses)
      .values(
        inputs.map((input) => ({
          projectId: input.projectId,
          sessionId: input.sessionId,
          analysisId: input.analysisId,
          agenteAlvo: input.agenteAlvo,
          observacao: input.observacao,
          hipotese: input.hipotese,
          sugestao: input.sugestao,
          confiancaPercent: input.confiancaPercent,
          evidenceEventIds: input.evidenceEventIds,
          terminationAnalysis: input.terminationAnalysis ?? null,
        })),
      )
      .returning();
    return rows.map(toEntity);
  }

  async findById(id: string): Promise<PsychologistHypothesis | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .select()
      .from(psychologistHypotheses)
      .where(eq(psychologistHypotheses.id, id))
      .limit(1);
    return row ? toEntity(row) : null;
  }

  async updateStatusIfProposed(
    id: string,
    status: Extract<HypothesisStatus, 'accepted' | 'dismissed'>,
    decidedBy: string,
    decidedAt: Date,
  ): Promise<PsychologistHypothesis | null> {
    const db = currentDb(this.rootDb);
    const [row] = await db
      .update(psychologistHypotheses)
      .set({ status, decidedBy, decidedAt, updatedAt: new Date() })
      // O `status = 'proposed'` no WHERE é o que torna isto atômico: sem
      // ele, dois accepts simultâneos passavam os dois pela checagem do use
      // case e o segundo sobrescrevia a decisão do primeiro.
      .where(
        and(
          eq(psychologistHypotheses.id, id),
          eq(psychologistHypotheses.status, 'proposed'),
        ),
      )
      .returning();
    return row ? toEntity(row) : null;
  }

  async countByAnalysisIds(
    analysisIds: string[],
  ): Promise<Record<string, number>> {
    if (analysisIds.length === 0) return {};
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({
        analysisId: psychologistHypotheses.analysisId,
        total: count(),
      })
      .from(psychologistHypotheses)
      .where(inArray(psychologistHypotheses.analysisId, analysisIds))
      .groupBy(psychologistHypotheses.analysisId);

    return Object.fromEntries(rows.map((r) => [r.analysisId, Number(r.total)]));
  }

  async listCurrentByProject(
    projectId: string,
  ): Promise<PsychologistHypothesis[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ hypothesis: psychologistHypotheses })
      .from(psychologistHypotheses)
      .innerJoin(
        psychologistAnalyses,
        eq(psychologistHypotheses.analysisId, psychologistAnalyses.id),
      )
      .where(
        and(
          eq(psychologistHypotheses.projectId, projectId),
          eq(psychologistAnalyses.superseded, false),
        ),
      )
      // Ordem estável na UI — sem ORDER BY o Postgres não promete nada e o
      // agrupamento do Insights trocava de ordem entre polls.
      .orderBy(desc(psychologistHypotheses.createdAt));
    return rows.map((r) => toEntity(r.hypothesis));
  }

  async listNonDismissedByProject(
    projectId: string,
  ): Promise<PsychologistHypothesis[]> {
    const db = currentDb(this.rootDb);
    const rows = await db
      .select({ hypothesis: psychologistHypotheses })
      .from(psychologistHypotheses)
      .innerJoin(
        psychologistAnalyses,
        eq(psychologistHypotheses.analysisId, psychologistAnalyses.id),
      )
      .where(
        and(
          eq(psychologistHypotheses.projectId, projectId),
          eq(psychologistAnalyses.superseded, false),
          ne(psychologistHypotheses.status, 'dismissed'),
        ),
      )
      .orderBy(desc(psychologistHypotheses.createdAt));
    return rows.map((r) => toEntity(r.hypothesis));
  }
}

function toEntity(
  row: typeof psychologistHypotheses.$inferSelect,
): PsychologistHypothesis {
  return {
    id: row.id,
    projectId: row.projectId,
    sessionId: row.sessionId,
    analysisId: row.analysisId,
    agenteAlvo: row.agenteAlvo,
    observacao: row.observacao,
    hipotese: row.hipotese,
    sugestao: row.sugestao,
    confiancaPercent: row.confiancaPercent,
    evidenceEventIds: row.evidenceEventIds,
    terminationAnalysis: row.terminationAnalysis,
    status: row.status as HypothesisStatus,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
