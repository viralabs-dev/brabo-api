import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_ROLE_KEY } from './require-role.decorator';
import { IS_PAT_ROUTE_KEY } from '../auth/pat-route.decorator';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { ResolveEffectiveRoleUseCase } from '../../../application/use-cases/iam/resolve-effective-role.use-case';
import { roleAtLeast, type Role } from '../../../domain/iam/role';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(
      REQUIRED_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRole) return true;

    // Rota `@RequirePatAuth()` (ADR 0105): `JwtAuthGuard` (global, roda
    // ANTES) já se abstém aqui de propósito, sem popular `request.user` —
    // quem autentica é `PatAuthGuard`, guard LOCAL da rota, que só roda
    // DEPOIS dos dois guards globais (`JwtAuthGuard`/`RolesGuard` — ordem
    // de execução do Nest, não configurável pela ordem dos decorators no
    // controller). Sem este desvio, `RolesGuard` recusava TODA chamada
    // aqui com `request.user` ainda vazio, e `PatAuthGuard` nunca chegava a
    // rodar (RN-438) — é por isso que autorização por papel nesta rota é
    // responsabilidade do PRÓPRIO `PatAuthGuard`, não deste guard.
    const isPatRoute = this.reflector.getAllAndOverride<boolean>(
      IS_PAT_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPatRoute) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) throw new ForbiddenException('Não autenticado');

    const projectId = firstParam(request.params.projectId);
    const workspaceId = firstParam(request.params.workspaceId);

    let effectiveRole: Role | null = null;
    if (projectId) {
      effectiveRole = await this.resolveEffectiveRole.forProject(
        user.id,
        projectId,
      );
    } else if (workspaceId) {
      effectiveRole = await this.resolveEffectiveRole.forWorkspace(
        user.id,
        workspaceId,
      );
    }

    if (!effectiveRole || !roleAtLeast(effectiveRole, requiredRole)) {
      throw new ForbiddenException('Papel insuficiente para esta ação');
    }

    request.effectiveRole = effectiveRole;
    return true;
  }
}

// Rotas com parâmetro repetido (ex.: `:foo*`) fariam o Express entregar
// um array — nossas rotas nunca fazem isso, mas o tipo do Express
// contempla a possibilidade.
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
