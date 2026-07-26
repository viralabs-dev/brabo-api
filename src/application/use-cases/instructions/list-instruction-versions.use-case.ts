import { Injectable } from '@nestjs/common';
import { AgentInstructionRepository } from '../../ports/agent-instruction-repository.port';
import { AgentInstructionVersionRepository } from '../../ports/agent-instruction-version-repository.port';
import { diffLines } from '../../../domain/instructions/text-diff';
import type { AgentInstructionVersion } from '../../../domain/instructions/agent-instruction-version.entity';
import type { DiffLine } from '../../../domain/instructions/text-diff';

export interface InstructionVersionView {
  id: string;
  version: number;
  content: string;
  createdBy: string | null;
  sourceActionId: string | null;
  sourceHypothesisId: string | null;
  note: string | null;
  createdAt: Date;
  isCurrent: boolean;
  // Diff DESTA versão em relação à anterior — calculado aqui pra a UI
  // não precisar de um differ próprio.
  diff: { lines: DiffLine[]; additions: number; deletions: number };
}

/**
 * Histórico de versões de um agente, mais recente primeiro, já com o
 * diff de cada versão contra a anterior (a mais antiga é diffada contra
 * vazio, então aparece como tudo-adição).
 */
@Injectable()
export class ListInstructionVersionsUseCase {
  constructor(
    private readonly versions: AgentInstructionVersionRepository,
    private readonly instructions: AgentInstructionRepository,
  ) {}

  async execute(
    projectId: string,
    agent: string,
  ): Promise<InstructionVersionView[]> {
    const [history, current] = await Promise.all([
      this.versions.listByAgent(projectId, agent),
      this.instructions.findByProjectAndAgent(projectId, agent),
    ]);

    // listByAgent devolve desc; pra diffar contra a anterior é mais
    // simples caminhar em ordem crescente.
    const ascending = [...history].sort((a, b) => a.version - b.version);

    return ascending
      .map((version, index) => toView(version, ascending[index - 1], current))
      .reverse();
  }
}

function toView(
  version: AgentInstructionVersion,
  previous: AgentInstructionVersion | undefined,
  current: { version: number } | null,
): InstructionVersionView {
  return {
    id: version.id,
    version: version.version,
    content: version.content,
    createdBy: version.createdBy,
    sourceActionId: version.sourceActionId,
    sourceHypothesisId: version.sourceHypothesisId,
    note: version.note,
    createdAt: version.createdAt,
    isCurrent: current?.version === version.version,
    diff: diffLines(previous?.content ?? '', version.content),
  };
}

/**
 * Histórico de TODOS os agentes que têm versão neste projeto, agrupado por
 * agente. A UI usava um roster estático pra descobrir de quem pedir histórico,
 * e assim nunca via os dev agents por módulo (`dev-api`) — que são os que
 * existem de verdade e os que a Anamnese patcheia.
 */
@Injectable()
export class ListProjectInstructionVersionsUseCase {
  constructor(
    private readonly versionRepo: AgentInstructionVersionRepository,
    private readonly listForAgent: ListInstructionVersionsUseCase,
  ) {}

  async execute(
    projectId: string,
  ): Promise<{ agent: string; versions: InstructionVersionView[] }[]> {
    const agents = await this.versionRepo.listAgentsWithHistory(projectId);

    return Promise.all(
      agents.map(async (agent) => ({
        agent,
        versions: await this.listForAgent.execute(projectId, agent),
      })),
    );
  }
}
