import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';

@Injectable()
export class GetProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string) {
    const project = await this.projects.findById(id);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
