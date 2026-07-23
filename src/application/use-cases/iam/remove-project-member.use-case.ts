import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';

@Injectable()
export class RemoveProjectMemberUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(projectId: string, userId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    await this.projects.removeMember(projectId, userId);
  }
}
