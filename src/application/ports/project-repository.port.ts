import type { Project } from '../../domain/iam/project.entity';
import type { ProjectMember } from '../../domain/iam/project-member.entity';
import type { Role } from '../../domain/iam/role';

export interface ProjectInput {
  name: string;
  slug: string;
}

export abstract class ProjectRepository {
  abstract create(
    input: ProjectInput & { workspaceId: string; createdBy: string },
  ): Promise<Project>;
  abstract findById(id: string): Promise<Project | null>;
  abstract update(
    id: string,
    input: Partial<ProjectInput>,
  ): Promise<Project | null>;
  abstract remove(id: string): Promise<Project | null>;
  abstract addMember(
    projectId: string,
    userId: string,
    role: Role,
  ): Promise<ProjectMember>;
  abstract findMemberRole(
    projectId: string,
    userId: string,
  ): Promise<Role | null>;
}
