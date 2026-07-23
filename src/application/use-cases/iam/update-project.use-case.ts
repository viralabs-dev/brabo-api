import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';

@Injectable()
export class UpdateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(id: string, input: Partial<ProjectInput>) {
    const row = await this.projects.update(id, input);
    if (!row) throw new NotFoundException('Projeto não encontrado');
    return row;
  }
}
