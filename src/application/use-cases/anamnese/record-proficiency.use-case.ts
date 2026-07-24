import { BadRequestException, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../ports/proficiency-profile-repository.port';
import {
  AnamneseQueueRepository,
  AnamneseRunRepository,
} from '../../ports/anamnese-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import { deriveCatalog } from '../../../domain/anamnese/competency-catalog';
import { validateProficiencyBatch } from '../../../domain/anamnese/proficiency-validation';
import type {
  ProficiencyDraft,
  ProficiencyLevel,
} from '../../../domain/anamnese/proficiency-validation';

export interface RecordProficiencyInput {
  sessionId: string;
  windowFrom: Date;
  windowTo: Date;
  eventCount: number;
  profiles: ProficiencyDraft[];
  // Entradas da fila consumidas por esta rodada.
  consumedQueueIds: string[];
}

/**
 * Alvo do tool `emit_proficiency` (Fase 4b). Valida o lote contra o
 * GUARDA-CORPO (catálogo de competências + membros elegíveis + evidência
 * real) ANTES de qualquer escrita, faz upsert dos perfis, marca a fila
 * como consumida e grava a rodada.
 *
 * A linha em `anamnese_runs` só nasce aqui — uma rodada que nunca
 * conclui não deixa marca, então o retry seguinte reprocessa a mesma
 * janela (mesma disciplina de psychologist_analyses).
 */
@Injectable()
export class RecordProficiencyUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly projects: ProjectRepository,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly sessionEvents: SessionEventRepository,
    private readonly profiles: ProficiencyProfileRepository,
    private readonly optOuts: AnamneseOptOutRepository,
    private readonly queue: AnamneseQueueRepository,
    private readonly runs: AnamneseRunRepository,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  async execute(projectId: string, input: RecordProficiencyInput) {
    const [members, moduleMap, optedOut] = await Promise.all([
      this.projects.listMembers(projectId),
      this.moduleMaps.findCurrent(projectId),
      this.optOuts.listOptedOutUserIds(projectId),
    ]);

    const optedOutSet = new Set(optedOut);
    const allowedUserIds = new Set(
      members.map((m) => m.userId).filter((id) => !optedOutSet.has(id)),
    );
    const catalog = deriveCatalog(
      (moduleMap?.modules ?? []).map((m) => m.stack),
    );
    const knownEventIds = await this.resolveKnownEventIds(input.profiles);

    const validation = validateProficiencyBatch(
      input.profiles,
      catalog,
      knownEventIds,
      allowedUserIds,
    );
    if (!validation.ok) throw new BadRequestException(validation.reason);

    return this.unitOfWork.runInTransaction(async () => {
      const saved = await this.profiles.upsertMany(
        input.profiles.map((p) => ({
          projectId,
          userId: p.userId,
          competency: p.competency,
          level: p.level as ProficiencyLevel,
          rationale: p.rationale,
          evidenceEventIds: p.evidenceEventIds,
        })),
      );

      await this.queue.markConsumed(input.consumedQueueIds);

      const run = await this.runs.create({
        projectId,
        sessionId: input.sessionId,
        windowFrom: input.windowFrom,
        windowTo: input.windowTo,
        eventCount: input.eventCount,
        profileCount: saved.length,
      });

      for (const profile of saved) {
        await this.appendSessionEvent.execute(projectId, input.sessionId, {
          type: 'anamnese.profile_updated',
          actor: { kind: 'agent', id: 'anamnese' },
          payload: {
            userId: profile.userId,
            competency: profile.competency,
            level: profile.level,
            rationale: profile.rationale,
            evidenceEventIds: profile.evidenceEventIds,
          },
        });
      }

      await this.appendSessionEvent.execute(projectId, input.sessionId, {
        type: 'anamnese.run_completed',
        actor: { kind: 'agent', id: 'anamnese' },
        payload: {
          runId: run.id,
          profileCount: saved.length,
          eventCount: input.eventCount,
          consumedHypotheses: input.consumedQueueIds.length,
        },
      });

      return { runId: run.id, profiles: saved };
    });
  }

  private async resolveKnownEventIds(
    drafts: ProficiencyDraft[],
  ): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (const draft of drafts) {
      for (const id of draft.evidenceEventIds) referenced.add(id);
    }

    const known = new Set<string>();
    await Promise.all(
      Array.from(referenced).map(async (id) => {
        const event = await this.sessionEvents.findById(id);
        if (event) known.add(id);
      }),
    );
    return known;
  }
}
