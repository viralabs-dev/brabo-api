import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import type { PermissionsConfig } from '../../../domain/actions/permission-resolver';

@Injectable()
export class SetProjectPermissionsUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  async execute(projectId: string, permissions: PermissionsConfig) {
    const project = await this.projects.updatePermissions(
      projectId,
      permissions,
    );
    if (!project) throw new NotFoundException('Projeto não encontrado');
    return project;
  }
}
