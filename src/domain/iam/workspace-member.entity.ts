import type { Role } from './role';

export interface WorkspaceMember {
  workspaceId: string;
  userId: string;
  role: Role;
  createdAt: Date;
}
