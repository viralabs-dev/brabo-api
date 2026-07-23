import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import type { Role } from '../../../domain/iam/role';

/** Núcleo do RBAC: papel de projeto sobrepõe o de workspace. */
@Injectable()
export class ResolveEffectiveRoleUseCase {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly workspaces: WorkspaceRepository,
  ) {}

  async forProject(userId: string, projectId: string): Promise<Role | null> {
    const project = await this.projects.findById(projectId);
    if (!project) return null;

    const projectRole = await this.projects.findMemberRole(projectId, userId);
    if (projectRole) return projectRole;

    return this.forWorkspace(userId, project.workspaceId);
  }

  forWorkspace(userId: string, workspaceId: string): Promise<Role | null> {
    return this.workspaces.findMemberRole(workspaceId, userId);
  }
}
