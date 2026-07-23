import type { Role } from './role';

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}

export interface ProjectMemberWithUser {
  userId: string;
  role: Role;
  name: string | null;
  email: string;
}
