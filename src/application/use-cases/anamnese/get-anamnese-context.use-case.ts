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
import { ProposedActionRepository } from '../../ports/proposed-action-repository.port';
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

/**
 * Decisão do usuário sobre uma ação proposta, dentro da janela. É o quarto
 * sinal do enunciado ("comandos que aprova/nega") — e o `rejectionReason` de
 * uma negação é o mais rico deles: diz o que a pessoa achou errado.
 */
export interface AnamneseContextDecision {
  actionType: string;
  status: string;
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
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
  // Aprovações/negações do usuário DENTRO da janela — não estão no event
  // log, então vêm por aqui.
  decisions: AnamneseContextDecision[];
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
    private readonly proposedActions: ProposedActionRepository,
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

    // Mesma janela que o engine usa pro event log: do fim da última rodada
    // (ou do início dos tempos, na primeira) até agora.
    const windowFrom = lastRun ? lastRun.windowTo : new Date(0);
    const decisions = await this.proposedActions.listDecidedInWindow(
      projectId,
      windowFrom,
      new Date(),
    );

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
      decisions: decisions
        .filter((a) => !optedOutSet.has(a.decidedBy ?? ''))
        .map((a) => ({
          actionType: a.actionType,
          status: a.status,
          rejectionReason: a.rejectionReason,
          decidedBy: a.decidedBy,
          decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
        })),
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
