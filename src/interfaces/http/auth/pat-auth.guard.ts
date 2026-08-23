import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PersonalAccessTokenRepository } from '../../../application/ports/personal-access-token-repository.port';
import { UserRepository } from '../../../application/ports/user-repository.port';
import { ResolveEffectiveRoleUseCase } from '../../../application/use-cases/iam/resolve-effective-role.use-case';
import { REQUIRED_ROLE_KEY } from '../iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../domain/iam/role';
import { hashDeToken } from '../../../infrastructure/security/auth-key-material';
import type { AuthenticatedRequest } from './authenticated-request';

const PREFIXO = 'brb_';

/**
 * Autentica E AUTORIZA um Personal Access Token (`brb_…`, ADR 0105) na rota
 * que o `IS_PAT_ROUTE_KEY` marcou — hoje só
 * `POST /projects/:projectId/runner-ticket`. `JwtAuthGuard` já retornou
 * `true` sem tentar verificar JWT nesta rota; este guard é quem estabelece
 * `request.user` de verdade.
 *
 * Nenhum serviço intermediário: injeta os dois ports direto, mesmo padrão de
 * `JwtAuthGuard` (que também não passa por uma camada de "AuthService").
 *
 * RN-439 fechou DOIS defeitos nesta rota, achados juntos numa verificação AO
 * VIVO (nenhum teste os pegava): a ordem de guards abaixo, e o token bruto
 * sendo comparado direto contra `token_hash` em `validarEUsar` (que sempre
 * espera o HASH — `hashDeToken(token)`, nunca o token em si). O segundo
 * ficou escondido atrás do primeiro: enquanto `RolesGuard` recusava tudo
 * antes deste guard rodar, o bug do hash nunca chegava a se manifestar.
 *
 * ## Por que a checagem de `@RequireRole` mora AQUI, e não em `RolesGuard`
 * (RN-439)
 *
 * `JwtAuthGuard` e `RolesGuard` são os dois `APP_GUARD` — GLOBAIS — e um
 * guard global SEMPRE roda antes de um guard local de rota (`@UseGuards`),
 * não importa a ordem dos decorators no controller. `JwtAuthGuard` se
 * abstém nesta rota (não popula `request.user`) contando com `PatAuthGuard`
 * pra autenticar depois — mas `RolesGuard` rodava ANTES de `PatAuthGuard`
 * mesmo assim, e sem o mesmo desvio recusava toda chamada com
 * `request.user` ainda vazio: `PatAuthGuard` nunca chegava a executar. O bug
 * sobreviveu porque nenhuma suíte exercitava os dois guards JUNTOS, só cada
 * um isolado. A correção: `RolesGuard` agora se abstém em rota
 * `@RequirePatAuth()` (mesmo desvio que `JwtAuthGuard` já tinha), e este
 * guard — o único que roda DEPOIS de `request.user` populado nesta rota —
 * passa a aplicar `@RequireRole` ele mesmo. MESMA lógica de
 * `RolesGuard.canActivate` (`../iam/roles.guard.ts`), duplicada aqui de
 * propósito: os dois guards moram em módulos diferentes (`auth`/`iam`) e uma
 * dependência cruzada só para reusar ~10 linhas não valeria a pena.
 */
@Injectable()
export class PatAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly users: UserRepository,
    private readonly reflector: Reflector,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
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

    // `validarEUsar` compara contra `token_hash` — recebe o HASH
    // (HMAC-SHA256+pepper, `TokenFactory.hashDe`/`IssuePersonalAccessTokenUseCase`
    // hasheiam o token INTEIRO, prefixo incluído), nunca o bruto. Achado
    // nesta mesma correção (RN-439): sem isto, `validarEUsar` nunca batia
    // com nada — a rota trocava um 403 sempre (guard errado na frente) por
    // um 401 sempre (hash nunca comparado), e o PAT nunca tinha funcionado
    // de ponta a ponta.
    //
    // Uma consulta só colapsa inexistente/revogado/expirado na MESMA
    // resposta (RN-425) — não dá pra quem apresenta um token roubado ou
    // expirado a informação de qual dos três é o motivo.
    const validado = await this.tokens.validarEUsar(hashDeToken(token));
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

    // `@RequireRole` desta rota (RN-439, ver o docblock acima) — revalida
    // que o dono do token ainda tem o papel exigido no projeto pela via
    // normal (`ProjectMember`/workspace). Cinto e suspensório: se o usuário
    // perder acesso ao projeto, o PAT para de funcionar mesmo sem ser
    // revogado explicitamente.
    const requiredRole = this.reflector.getAllAndOverride<Role | undefined>(
      REQUIRED_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRole) {
      const effectiveRole = await this.resolveEffectiveRole.forProject(
        usuario.id,
        projectId,
      );
      if (!effectiveRole || !roleAtLeast(effectiveRole, requiredRole)) {
        throw new ForbiddenException('Papel insuficiente para esta ação');
      }
      request.effectiveRole = effectiveRole;
    }

    return true;
  }
}

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
