import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';

@Injectable()
export class GetAgentAutonomyUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
  ) {}

  async execute(projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return this.agentAutonomy.listForProject(projectId);
  }
}
