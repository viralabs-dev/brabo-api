import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';

@Injectable()
export class ListProjectsForWorkspaceUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  execute(workspaceId: string) {
    return this.projects.listForWorkspace(workspaceId);
  }
}
