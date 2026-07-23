import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';

@Injectable()
export class DeleteProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string) {
    const row = await this.projects.remove(id);
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }
}
