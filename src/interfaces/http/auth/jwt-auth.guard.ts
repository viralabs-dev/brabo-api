import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { IS_SERVICE_ROUTE_KEY } from './service-route.decorator';
import { IS_PAT_ROUTE_KEY } from './pat-route.decorator';
import type { AuthenticatedRequest } from './authenticated-request';
import {
  TokenVerifier,
  type VerifiedToken,
} from '../../../application/ports/token-verifier.port';
import { UserRepository } from '../../../application/ports/user-repository.port';

/**
 * Autenticação de usuário (Fase 1, emissor trocado na Fase 7a).
 *
 * ## O que o corte mudou aqui
 *
 * Antes o guard fazia UPSERT do usuário a cada requisição: o Keycloak era a
 * fonte da verdade da identidade, e a tabela `users` da api era um espelho que
 * precisava ser reconciliado a todo momento. Com o emissor próprio, o `sub` do
 * token JÁ É o `users.id` — a api emitiu aquele token para aquela linha. Não há
 * o que reconciliar, e o guard passa a só LER.
 *
 * Isso não é otimização: reaproveitar o `upsertFromKeycloak` aqui seria um bug
 * silencioso e caro. Ele faz conflito em `keycloak_sub`, então com o `sub`
 * novo tentaria INSERIR uma linha com o mesmo e-mail de uma existente,
 * violando `users_email_lower_idx` — uma exceção fora do `try/catch` abaixo,
 * ou seja, 500 em vez de 401, em toda requisição autenticada.
 *
 * ## Usuário some do banco = 401, não 500
 *
 * Um token válido cujo `sub` não existe mais é uma sessão órfã (conta apagada
 * com o access token ainda dentro da janela de 15 min). 401 é a resposta
 * correta e faz o cliente cair no fluxo de login.
 *
 * ## O que este guard promete ao resto da api
 *
 * `request.user` é a linha PERSISTIDA cujo `id` é o mesmo que aparece em
 * `project_members.user_id` e `workspace_members.user_id`. É disso, e só
 * disso, que todo o RBAC depende — nenhuma decisão de papel lê claim de token.
 * Por isso a matriz de permissões atravessa a troca de emissor sem mudar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenVerifier: TokenVerifier,
    private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const alvo = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      alvo,
    );
    if (isPublic) return true;

    // Tráfego serviço→serviço não tem usuário para autenticar. Quem valida é o
    // EngineServiceGuard, com o segredo compartilhado.
    const isServico = this.reflector.getAllAndOverride<boolean>(
      IS_SERVICE_ROUTE_KEY,
      alvo,
    );
    if (isServico) return true;

    // Rota autenticável só por Personal Access Token (ADR 0105) — quem
    // valida é o PatAuthGuard, que roda depois deste retornar `true`. Nunca
    // tenta `tokenVerifier.verify()` aqui: um `brb_...` não é JWT.
    const isPat = this.reflector.getAllAndOverride<boolean>(
      IS_PAT_ROUTE_KEY,
      alvo,
    );
    if (isPat) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Token ausente');

    let verified: VerifiedToken;
    try {
      verified = await this.tokenVerifier.verify(token);
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    const usuario = await this.users.findById(verified.sub);
    if (!usuario) throw new UnauthorizedException('Token inválido');

    request.user = usuario;
    return true;
  }
}

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
