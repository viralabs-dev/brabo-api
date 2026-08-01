import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { TokenUsageRepository } from '../../ports/token-usage-repository.port';

/**
 * Resumo do workspace pro topo do dashboard de projetos: quantos projetos,
 * quantos agentes trabalharam e quanto se gastou neste mês.
 *
 * `activeProjects` não filtra nada — a tabela `projects` não tem flag de
 * "ativo", então todo projeto do workspace conta. "Ativos" é copy da tela,
 * não um estado do domínio.
 */
export interface WorkspaceSummary {
  activeProjects: number;
  agentCount: number;
  spentMicros: number;
}

@Injectable()
export class GetWorkspaceSummaryUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly tokenUsage: TokenUsageRepository,
  ) {}

  async execute(workspaceId: string): Promise<WorkspaceSummary> {
    const [projectList, usage] = await Promise.all([
      this.projects.listForWorkspace(workspaceId),
      this.tokenUsage.summarizeForWorkspaceThisMonth(workspaceId),
    ]);

    return {
      activeProjects: projectList.length,
      agentCount: usage.agentCount,
      spentMicros: usage.spentMicros,
    };
  }
}
