import { Injectable } from '@nestjs/common';
import {
  ProjectRepository,
  type ProjectInput,
} from '../../ports/project-repository.port';

@Injectable()
export class CreateProjectUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  execute(workspaceId: string, userId: string, input: ProjectInput) {
    return this.projects.create({ ...input, workspaceId, createdBy: userId });
  }
}
