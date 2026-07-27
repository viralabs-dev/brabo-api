import { BadRequestException, Injectable } from '@nestjs/common';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { SessionEventRepository } from '../../ports/session-event-repository.port';
import { SessionRepository } from '../../ports/session-repository.port';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../ports/proficiency-profile-repository.port';
import { AnamneseRunRepository } from '../../ports/anamnese-repository.port';
import { AppendSessionEventUseCase } from '../sessions/append-session-event.use-case';
import {
  deriveCatalog,
  normalizeCompetency,
} from '../../../domain/anamnese/competency-catalog';
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
}

/**
 * Alvo do tool `emit_proficiency` (Fase 4b). Valida o lote contra o
 * GUARDA-CORPO (catálogo de competências + membros elegíveis + evidência
 * real) ANTES de qualquer escrita, faz upsert dos perfis e grava a rodada.
 *
 * A fila de hipóteses NÃO é consumida aqui: quem consome é
 * `ProposeInstructionPatchUseCase`, quando o patch que referencia a hipótese
 * nasce. Antes o engine mandava os ids junto dos perfis e a hipótese era
 * queimada mesmo sem patch nenhum.
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
    private readonly sessions: SessionRepository,
    private readonly profiles: ProficiencyProfileRepository,
    private readonly optOuts: AnamneseOptOutRepository,
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
    const knownEventIds = await this.resolveKnownEventIds(
      projectId,
      input.profiles,
    );

    const validation = validateProficiencyBatch(
      input.profiles,
      catalog,
      knownEventIds,
      allowedUserIds,
    );
    if (!validation.ok) throw new BadRequestException(validation.reason);

    // O upsert é um único INSERT ... ON CONFLICT DO UPDATE, e o Postgres
    // recusa afetar a MESMA linha duas vezes no mesmo comando ("ON CONFLICT
    // DO UPDATE command cannot affect row a second time"). Duas entradas
    // para o mesmo (userId, competency) viravam um 500 opaco em vez de um
    // tool-result que o modelo consegue corrigir.
    const duplicada = primeiraDuplicata(input.profiles);
    if (duplicada) {
      throw new BadRequestException(
        `competência "${duplicada}" aparece duas vezes para o mesmo usuário no lote — ` +
          'emita uma entrada por (usuário, competência), com o nível consolidado',
      );
    }

    return this.unitOfWork.runInTransaction(async () => {
      const saved = await this.profiles.upsertMany(
        input.profiles.map((p) => ({
          projectId,
          userId: p.userId,
          // Normalizado na GRAVAÇÃO, não só na comparação: o unique é
          // (project, user, competency), então "NestJS" e "nestjs " criavam
          // duas linhas para a mesma competência.
          competency: normalizeCompetency(p.competency),
          level: p.level as ProficiencyLevel,
          rationale: p.rationale,
          evidenceEventIds: p.evidenceEventIds,
        })),
      );

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
        },
      });

      return { runId: run.id, profiles: saved };
    });
  }

  // O evento tem que existir E ser de uma sessão DESTE projeto — a mensagem
  // de rejeição já prometia "deste projeto", mas a checagem aceitava um id de
  // qualquer projeto. Mesma disciplina do ProposeHypothesesUseCase.
  private async resolveKnownEventIds(
    projectId: string,
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
        if (!event) return;
        const session = await this.sessions.findInProject(
          projectId,
          event.sessionId,
        );
        if (session) known.add(id);
      }),
    );
    return known;
  }
}

// Primeira competência repetida para o mesmo usuário no lote (comparando
// normalizado, que é como a linha vai pro banco), ou null.
function primeiraDuplicata(drafts: ProficiencyDraft[]): string | null {
  const vistas = new Set<string>();
  for (const draft of drafts) {
    const chave = `${draft.userId}::${normalizeCompetency(draft.competency)}`;
    if (vistas.has(chave)) return draft.competency;
    vistas.add(chave);
  }
  return null;
}
