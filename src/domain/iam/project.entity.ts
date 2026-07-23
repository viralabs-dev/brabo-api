import type { PermissionsConfig } from '../actions/permission-resolver';

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdBy: string;
  permissions: PermissionsConfig;
  createdAt: Date;
  updatedAt: Date;
}
