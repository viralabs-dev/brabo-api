import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { AgentAutonomyRepository } from '../../ports/agent-autonomy-repository.port';
import type { PermissionPolicy } from '../../../domain/actions/permissions-file';
import type { AgentAutonomyActionType } from '../../../domain/actions/decide';

@Injectable()
export class SetAgentAutonomyUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly agentAutonomy: AgentAutonomyRepository,
  ) {}

  async execute(
    projectId: string,
    agentId: string,
    actionType: AgentAutonomyActionType,
    mode: PermissionPolicy,
  ) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    await this.agentAutonomy.upsert(projectId, agentId, actionType, mode);
  }
}
