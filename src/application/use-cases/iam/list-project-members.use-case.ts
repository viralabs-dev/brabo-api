import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';

@Injectable()
export class ListProjectMembersUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return this.projects.listMembers(projectId);
  }
}
