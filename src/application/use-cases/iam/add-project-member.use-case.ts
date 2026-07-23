import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../ports/project-repository.port';
import type { Role } from '../../../domain/iam/role';

@Injectable()
export class AddProjectMemberUseCase {
  constructor(private readonly projects: ProjectRepository) {}

  execute(projectId: string, userId: string, role: Role) {
    return this.projects.addMember(projectId, userId, role);
  }
}
