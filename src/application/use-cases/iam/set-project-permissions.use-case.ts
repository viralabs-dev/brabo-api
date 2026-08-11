import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { PermissionsFileStore } from '../../ports/permissions-file-store.port';
import type { PermissionsFile } from '../../../domain/actions/permissions-file';

@Injectable()
export class SetProjectPermissionsUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly permissionsFileStore: PermissionsFileStore,
  ) {}

  async execute(projectId: string, file: PermissionsFile) {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Projeto não encontrado');
    await this.permissionsFileStore.write(project.workspaceDirName, file);
    return file;
  }
}
