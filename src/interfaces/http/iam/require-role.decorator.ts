import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../../domain/iam/role';

export const REQUIRED_ROLE_KEY = 'requiredRole';

/**
 * Exige um papel efetivo mínimo na rota. O RolesGuard resolve o papel
 * a partir de `:projectId` (com fallback pro workspace do projeto) ou,
 * na ausência dele, de `:workspaceId`.
 */
export const RequireRole = (role: Role) => SetMetadata(REQUIRED_ROLE_KEY, role);
