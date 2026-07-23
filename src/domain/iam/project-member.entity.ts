import type { Role } from './role';

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}
