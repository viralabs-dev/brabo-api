import { Injectable } from '@nestjs/common';
import { WorkspaceRepository } from '../../ports/workspace-repository.port';
import type { Role } from '../../../domain/iam/role';

@Injectable()
export class AddWorkspaceMemberUseCase {
  constructor(private readonly workspaces: WorkspaceRepository) {}

  execute(workspaceId: string, userId: string, role: Role) {
    return this.workspaces.addMember(workspaceId, userId, role);
  }
}
