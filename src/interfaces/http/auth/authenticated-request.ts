import type { Request } from 'express';
import type { User } from '../../../domain/iam/user.entity';
import type { Role } from '../../../domain/iam/role';

export interface AuthenticatedRequest extends Request {
  user: User;
  effectiveRole?: Role;
}
