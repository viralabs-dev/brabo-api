import type { Workspace } from '../../domain/iam/workspace.entity';
import type { WorkspaceMember } from '../../domain/iam/workspace-member.entity';
import type { Role } from '../../domain/iam/role';

export interface WorkspaceInput {
  name: string;
  slug: string;
}

export interface WorkspaceWithRole {
  workspace: Workspace;
  role: Role;
}

export abstract class WorkspaceRepository {
  abstract create(
    input: WorkspaceInput & { createdBy: string },
  ): Promise<Workspace>;
  abstract addMember(
    workspaceId: string,
    userId: string,
    role: Role,
  ): Promise<WorkspaceMember>;
  abstract findById(id: string): Promise<Workspace | null>;
  abstract listForUser(userId: string): Promise<WorkspaceWithRole[]>;
  abstract update(
    id: string,
    input: Partial<WorkspaceInput>,
  ): Promise<Workspace | null>;
  abstract remove(id: string): Promise<Workspace | null>;
  abstract findMemberRole(
    workspaceId: string,
    userId: string,
  ): Promise<Role | null>;
}
