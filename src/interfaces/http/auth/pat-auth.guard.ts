import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PersonalAccessTokenRepository } from '../../../application/ports/personal-access-token-repository.port';
import { UserRepository } from '../../../application/ports/user-repository.port';
import type { AuthenticatedRequest } from './authenticated-request';

const PREFIXO = 'brb_';

/**
 * Autentica um Personal Access Token (`brb_…`, ADR 0105) na rota que o
 * `IS_PAT_ROUTE_KEY` marcou — hoje só `POST /projects/:projectId/runner-ticket`.
 * `JwtAuthGuard` já retornou `true` sem tentar verificar JWT nesta rota; este
 * guard é quem estabelece `request.user` de verdade.
 *
 * Nenhum serviço intermediário: injeta os dois ports direto, mesmo padrão de
 * `JwtAuthGuard` (que também não passa por uma camada de "AuthService").
 *
 * `RolesGuard`/`@RequireRole` continuam rodando DEPOIS deste guard,
 * inalterados — revalidam que o dono do token ainda tem o papel exigido no
 * projeto pela via normal (`ProjectMember`/workspace). Cinto e suspensório:
 * se o usuário perder acesso ao projeto, o PAT para de funcionar mesmo sem
 * ser revogado explicitamente.
 */
@Injectable()
export class PatAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    // Nunca dual-auth com JWT nesta rota (ver o docblock de
    // `@RequirePatAuth()`) — qualquer coisa que não comece com `brb_` é
    // recusada aqui, sem tentar outro caminho.
    if (!token || !token.startsWith(PREFIXO)) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    // Uma consulta só colapsa inexistente/revogado/expirado na MESMA
    // resposta (RN-425) — não dá pra quem apresenta um token roubado ou
    // expirado a informação de qual dos três é o motivo.
    const validado = await this.tokens.validarEUsar(token);
    if (!validado) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    // Escopo `runner:project:<id>`: o token autenticou, só não tem direito
    // a ESTE projeto — categoria diferente de "token inválido" (403, não
    // 401), mesma distinção que `RolesGuard` já faz pra papel insuficiente.
    const projectId = request.params.projectId;
    if (validado.projectId !== projectId) {
      throw new ForbiddenException('Token não autorizado para este projeto');
    }

    const usuario = await this.users.findById(validado.userId);
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
