import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { ModuleMapRepository } from '../../ports/module-map-repository.port';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';
import { PsychologistHypothesisRepository } from '../../ports/psychologist-hypothesis-repository.port';
import {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../ports/proficiency-profile-repository.port';
import {
  AnamneseQueueRepository,
  AnamneseRunRepository,
} from '../../ports/anamnese-repository.port';
import { deriveCatalog } from '../../../domain/anamnese/competency-catalog';

export interface AnamneseContextMember {
  userId: string;
  name: string | null;
  email: string;
  role: string;
}

export interface AnamneseContextQueued {
  queueId: string;
  hypothesisId: string;
  agenteAlvo: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
}

export interface AnamneseContextProfile {
  userId: string;
  competency: string;
  level: string;
  rationale: string;
}

export interface AnamneseContextInstruction {
  agent: string;
  version: number;
  content: string;
}

export interface AnamneseContext {
  // Catálogo permitido — o modelo NÃO pode emitir competência fora daqui
  // (a validação rejeita), então vai no prompt como lista fechada.
  competencyCatalog: string[];
  // Membros elegíveis: já EXCLUI quem optou por não ser perfilado.
  members: AnamneseContextMember[];
  // Hipóteses aceitas do Psicólogo esperando virar input priorizado.
  queuedHypotheses: AnamneseContextQueued[];
  currentProfiles: AnamneseContextProfile[];
  instructions: AnamneseContextInstruction[];
  // Janela a analisar: do fim da última rodada até agora.
  windowFrom: string | null;
}

/**
 * Contexto da rodada da Anamnese (Fase 4b) — UMA chamada com tudo,
 * espelhando GetPsychologistContextUseCase. A janela de eventos em si o
 * engine lê direto do Postgres (mais barato que trafegar por HTTP).
 */
@Injectable()
export class GetAnamneseContextUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly moduleMaps: ModuleMapRepository,
    private readonly instructions: AgentInstructionRepository,
    private readonly hypotheses: PsychologistHypothesisRepository,
    private readonly profiles: ProficiencyProfileRepository,
    private readonly optOuts: AnamneseOptOutRepository,
    private readonly queue: AnamneseQueueRepository,
    private readonly runs: AnamneseRunRepository,
  ) {}

  async execute(projectId: string): Promise<AnamneseContext> {
    const [members, moduleMap, optedOut, pending, currentProfiles, lastRun] =
      await Promise.all([
        this.projects.listMembers(projectId),
        this.moduleMaps.findCurrent(projectId),
        this.optOuts.listOptedOutUserIds(projectId),
        this.queue.listPending(projectId),
        this.profiles.listByProject(projectId),
        this.runs.findLatest(projectId),
      ]);

    const optedOutSet = new Set(optedOut);
    const eligible = members.filter((m) => !optedOutSet.has(m.userId));

    const catalog = deriveCatalog(
      (moduleMap?.modules ?? []).map((m) => m.stack),
    );

    const queuedHypotheses = await this.resolveQueue(pending);
    const instructions = await this.resolveInstructions(
      projectId,
      queuedHypotheses,
    );

    return {
      competencyCatalog: [...catalog],
      members: eligible.map((m) => ({
        userId: m.userId,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
      queuedHypotheses,
      currentProfiles: currentProfiles
        .filter((p) => !optedOutSet.has(p.userId))
        .map((p) => ({
          userId: p.userId,
          competency: p.competency,
          level: p.level,
          rationale: p.rationale,
        })),
      instructions,
      windowFrom: lastRun ? lastRun.windowTo.toISOString() : null,
    };
  }

  private async resolveQueue(
    pending: { id: string; hypothesisId: string }[],
  ): Promise<AnamneseContextQueued[]> {
    const resolved = await Promise.all(
      pending.map(async (entry) => {
        const hypothesis = await this.hypotheses.findById(entry.hypothesisId);
        if (!hypothesis) return null;
        return {
          queueId: entry.id,
          hypothesisId: hypothesis.id,
          agenteAlvo: hypothesis.agenteAlvo,
          hipotese: hypothesis.hipotese,
          sugestao: hypothesis.sugestao,
          confiancaPercent: hypothesis.confiancaPercent,
        };
      }),
    );
    return resolved.filter((h): h is AnamneseContextQueued => h !== null);
  }

  // Só as instruções dos agentes que a rodada pode querer patchear: os
  // alvos das hipóteses enfileiradas. Sem hipótese na fila, nenhuma
  // instrução vai no prompt (a rodada é só de perfil).
  private async resolveInstructions(
    projectId: string,
    queued: AnamneseContextQueued[],
  ): Promise<AnamneseContextInstruction[]> {
    const agents = [...new Set(queued.map((q) => q.agenteAlvo))];
    const resolved = await Promise.all(
      agents.map(async (agent) => {
        const instruction = await this.instructions.findByProjectAndAgent(
          projectId,
          agent,
        );
        return instruction
          ? {
              agent,
              version: instruction.version,
              content: instruction.content,
            }
          : null;
      }),
    );
    return resolved.filter((i): i is AnamneseContextInstruction => i !== null);
  }
}
