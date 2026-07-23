import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './authenticated-request';
import {
  TokenVerifier,
  type VerifiedToken,
} from '../../../application/ports/token-verifier.port';
import { SyncUserUseCase } from '../../../application/use-cases/iam/sync-user.use-case';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
    private readonly syncUser: SyncUserUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Token ausente');

    let verified: VerifiedToken;
    try {
      verified = await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    request.user = await this.syncUser.execute({
      keycloakSub: verified.sub,
      email: verified.email,
      name: verified.name,
    });
    request.clientId = verified.clientId;

    return true;
  }
}

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
