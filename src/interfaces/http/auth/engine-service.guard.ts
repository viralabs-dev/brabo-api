import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';

/**
 * Roda depois do JwtAuthGuard (global), que já validou assinatura/issuer
 * do token — este guard só decide QUAL client é dono do token válido,
 * restringindo a rota ao service account do engine.
 */
@Injectable()
export class EngineServiceGuard implements CanActivate {
  private readonly expectedClientId =
    process.env.ENGINE_KEYCLOAK_CLIENT_ID ?? 'engine-service';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.clientId !== this.expectedClientId) {
      throw new ForbiddenException('Chamada restrita ao serviço engine');
    }
    return true;
  }
}
