import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { PersonalAccessTokenRepository } from '../../../application/ports/personal-access-token-repository.port';
import { RunnerDeviceKeyRepository } from '../../../application/ports/runner-device-key-repository.port';
import { UserRepository } from '../../../application/ports/user-repository.port';
import type { User } from '../../../domain/iam/user.entity';
import { ResolveEffectiveRoleUseCase } from '../../../application/use-cases/iam/resolve-effective-role.use-case';
import { REQUIRED_ROLE_KEY } from '../iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../domain/iam/role';
import { hashDeToken } from '../../../infrastructure/security/auth-key-material';
import type { AuthenticatedRequest } from './authenticated-request';

const PREFIXO_PAT = 'brb_';

/** TTL máximo do JWT de chave de dispositivo — `exp - iat`, nunca `exp` sozinho. */
const TTL_MAXIMO_DEVICE_KEY_SEGUNDOS = 60;

/**
 * Autentica E AUTORIZA a rota que o `IS_PAT_ROUTE_KEY` marcou — hoje só
 * `POST /projects/:projectId/runner-ticket` — aceitando DUAS formas de
 * credencial de DISPOSITIVO (nenhuma das duas é o JWT de sessão do login):
 *
 * 1. Personal Access Token (`brb_…`, ADR 0105) — segredo compartilhado,
 *    digitado pelo usuário no `brabo-runner` (`--token`/
 *    `BRABO_ACCOUNT_TOKEN`).
 * 2. Chave de dispositivo (Ed25519, gerada no navegador — ver
 *    `RunnerDeviceKeysController`) — o runner assina um JWT curto (EdDSA)
 *    provando posse da privada, sem o usuário digitar nada.
 *
 * `JwtAuthGuard` já retornou `true` sem tentar verificar JWT nesta rota;
 * este guard é quem estabelece `request.user` de verdade, por QUALQUER um
 * dos dois caminhos.
 *
 * ## Isto NÃO é "dual-auth com JWT de sessão" (RN-439)
 *
 * A garantia que RN-439 fechou continua de pé: esta rota nunca aceita o
 * JWT de LOGIN como fallback — não há chamador de browser autenticado por
 * sessão pra esta rota, e aceitar o JWT de sessão aqui faria `RolesGuard`/
 * `@RequireRole` autorizarem esse usuário pra tudo que o papel dele permite
 * no resto da api, estourando o escopo `runner:project:<id>` do PAT (ver o
 * docblock de `@RequirePatAuth()`). O JWT de chave de dispositivo é uma
 * bicho DIFERENTE: autoassinado pelo PRÓPRIO runner com uma chave que a api
 * nunca viu a privada, sem `sub` de usuário nenhum vindo do token (o
 * `userId` vem do REGISTRO salvo em `runner_device_keys`, nunca do claim) —
 * é só uma segunda forma de provar "sou o dispositivo de tal usuário nesse
 * projeto", tão escopada quanto o PAT que ela complementa.
 *
 * Nenhum serviço intermediário: injeta os ports direto, mesmo padrão de
 * `JwtAuthGuard` (que também não passa por uma camada de "AuthService").
 *
 * RN-439 fechou DOIS defeitos nesta rota, achados juntos numa verificação AO
 * VIVO (nenhum teste os pegava): a ordem de guards abaixo, e o token bruto
 * sendo comparado direto contra `token_hash` em `validarEUsar` (que sempre
 * espera o HASH — `hashDeToken(token)`, nunca o bruto). O segundo ficou
 * escondido atrás do primeiro: enquanto `RolesGuard` recusava tudo antes
 * deste guard rodar, o bug do hash nunca chegava a se manifestar.
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
 * dependência cruzada só para reusar ~10 linhas não valeria a pena. A
 * checagem de papel é a MESMA função privada (`autorizarPapel`) pros dois
 * caminhos de credencial — nada duplicado entre PAT e chave de dispositivo.
 */
@Injectable()
export class PatAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: PersonalAccessTokenRepository,
    private readonly users: UserRepository,
    private readonly reflector: Reflector,
    private readonly resolveEffectiveRole: ResolveEffectiveRoleUseCase,
    private readonly deviceKeys: RunnerDeviceKeyRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    if (token.startsWith(PREFIXO_PAT)) {
      return this.autenticarPat(token, request, context);
    }

    // Formato de JWT compacto (header.payload.signature) — o caminho de
    // chave de dispositivo. Qualquer outra coisa é recusada sem tentar mais
    // nada, mesma disciplina de antes.
    if (token.split('.').length === 3) {
      return this.autenticarChaveDeDispositivo(token, request, context);
    }

    throw new UnauthorizedException('Token ausente ou inválido');
  }

  private async autenticarPat(
    token: string,
    request: AuthenticatedRequest,
    context: ExecutionContext,
  ): Promise<boolean> {
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

    const usuario = await this.carregarUsuarioOuFalhar(validado.userId);
    await this.autorizarPapel(context, request, usuario, validado.projectId);
    return true;
  }

  private async autenticarChaveDeDispositivo(
    token: string,
    request: AuthenticatedRequest,
    context: ExecutionContext,
  ): Promise<boolean> {
    // `decodeProtectedHeader` NÃO verifica assinatura — só lê o header pra
    // achar o `kid`. A verificação de verdade vem depois, contra a chave
    // pública que ESSE `kid` aponta no banco.
    let kid: string | undefined;
    try {
      kid = decodeProtectedHeader(token).kid;
    } catch {
      throw new UnauthorizedException('Token ausente ou inválido');
    }
    if (!kid) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    const chave = await this.deviceKeys.buscarChavePublicaAtiva(kid);
    if (!chave) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    let jwk: unknown;
    try {
      jwk = JSON.parse(chave.publicKeyJwk);
    } catch {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    let payload: Record<string, unknown>;
    try {
      const chavePublica = await importJWK(
        jwk as Parameters<typeof importJWK>[0],
        'EdDSA',
      );
      const verificado = await jwtVerify(token, chavePublica, {
        algorithms: ['EdDSA'],
      });
      payload = verificado.payload;
    } catch {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    // TTL curto e OBRIGATÓRIO: `jwtVerify` já recusa `exp` no passado, mas
    // não impede um `exp` de vida LONGA no futuro — é essa janela que se
    // fecha aqui, comparando `exp` contra `iat`, não contra "agora". Um JWT
    // de vida longa reaproveitado (roubado do disco do runner, por exemplo)
    // fica útil por no máximo este TTL a partir de quando foi ASSINADO,
    // nunca a partir de quando foi capturado.
    const { iat, exp } = payload;
    if (
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      exp - iat > TTL_MAXIMO_DEVICE_KEY_SEGUNDOS
    ) {
      throw new UnauthorizedException('Token ausente ou inválido');
    }

    // Escopo de projeto ANTES de carregar o usuário — mesma ordem/mesma
    // distinção 401 vs 403 do caminho PAT: token válido pro projeto errado
    // é categoria diferente de token inválido.
    if (payload.projectId !== request.params.projectId) {
      throw new ForbiddenException('Token não autorizado para este projeto');
    }

    // O usuário vem do REGISTRO salvo, nunca de um claim do JWT — o token só
    // precisa provar posse da privada, não afirmar quem é o dono.
    const usuario = await this.carregarUsuarioOuFalhar(chave.userId);
    await this.autorizarPapel(context, request, usuario, chave.projectId);
    await this.deviceKeys.tocarUso(chave.id);
    return true;
  }

  private async carregarUsuarioOuFalhar(userId: string): Promise<User> {
    const usuario = await this.users.findById(userId);
    if (!usuario) throw new UnauthorizedException('Token inválido');
    return usuario;
  }

  /**
   * Escopo `runner:project:<id>` + `@RequireRole` desta rota (RN-439) —
   * compartilhado pelos dois caminhos de credencial. Revalida que o dono do
   * token/chave ainda tem o papel exigido no projeto pela via normal
   * (`ProjectMember`/workspace). Cinto e suspensório: se o usuário perder
   * acesso ao projeto, a credencial para de funcionar mesmo sem ser
   * revogada explicitamente.
   */
  private async autorizarPapel(
    context: ExecutionContext,
    request: AuthenticatedRequest,
    usuario: User,
    projectId: string,
  ): Promise<void> {
    if (projectId !== request.params.projectId) {
      throw new ForbiddenException('Token não autorizado para este projeto');
    }

    request.user = usuario;

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
  }
}

function extractBearerToken(header?: string): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
