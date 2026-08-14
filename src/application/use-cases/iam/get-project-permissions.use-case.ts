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
    // O `project` inteiro, e não só o nome da pasta: desde o ADR 0072 é o par
    // (modo, caminho) que diz onde o permissions.json mora (RN-169).
    return this.permissionsFileStore.read(project);
  }
}
