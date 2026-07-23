import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';

@Injectable()
export class GetProjectPermissionsUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
  ) {}

  async execute(projectId: string) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return this.permissionsFileStore.read(projectId);
  }
}
