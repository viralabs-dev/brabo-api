import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from './public.decorator';
import { LoginUseCase } from '../../../application/use-cases/auth/login.use-case';
import { LogoutUseCase } from '../../../application/use-cases/auth/logout.use-case';
import { RefreshUseCase } from '../../../application/use-cases/auth/refresh.use-case';
import { RegisterUseCase } from '../../../application/use-cases/auth/register.use-case';
import { RequestPasswordResetUseCase } from '../../../application/use-cases/auth/request-password-reset.use-case';
import { ResetPasswordUseCase } from '../../../application/use-cases/auth/reset-password.use-case';
import { SocialLoginCallbackUseCase } from '../../../application/use-cases/auth/social-login-callback.use-case';
import { StartSocialLoginUseCase } from '../../../application/use-cases/auth/start-social-login.use-case';
import { VerifyEmailUseCase } from '../../../application/use-cases/auth/verify-email.use-case';
import type { SocialOauthProviderName } from '../../../domain/auth/social-oauth-state';
import type { ContextoDaRequisicao } from '../../../application/use-cases/auth/auth-config';
import {
  AceiteResponseDto,
  LoginDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  SessaoResponseDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  definirCookiesDeSessao,
  exigirCsrf,
  limparCookiesDeSessao,
  refreshDoCookie,
} from './session-cookies';
import { authConfig } from '../../../application/use-cases/auth/auth-config';

const SOCIAL_PROVIDERS = ['github', 'gitlab'] as const;

function parseSocialProvider(value: string): SocialOauthProviderName {
  if (!SOCIAL_PROVIDERS.includes(value as SocialOauthProviderName)) {
    throw new BadRequestException(`Provider inválido: ${value}`);
  }
  return value as SocialOauthProviderName;
}

const ACEITE = {
  message: 'Se o endereço estiver disponível, enviamos um e-mail.',
};

/**
 * Auth first-party (Fase 7a).
 *
 * ## Por que TODAS as rotas são `@Public()`
 *
 * São o caminho por onde se OBTÉM um access token, e o `JwtAuthGuard` global
 * exige um. Atrás do guard, cada uma pediria a credencial que ela mesma emite.
 * O `logout` é a única que poderia ser autenticada, e não é de propósito: a
 * credencial que lhe interessa é o refresh no cookie, com o par de CSRF, e
 * deslogar precisa funcionar com o access token já expirado.
 *
 * ## O que protege estas rotas
 *
 * NÃO é o `RateLimitGuard`: ele libera rota `@Public()` (ver rate-limit.guard.ts,
 * e a justificativa de não estrangular `/health`). Quem segura esta superfície
 * é o lockout progressivo por e-mail e por IP, dentro dos casos de uso. Isso
 * não é reforço opcional — é a única defesa que existe aqui.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registrar: RegisterUseCase,
    private readonly login: LoginUseCase,
    private readonly refresh: RefreshUseCase,
    private readonly logout: LogoutUseCase,
    private readonly verificarEmail: VerifyEmailUseCase,
    private readonly pedirReset: RequestPasswordResetUseCase,
    private readonly resetar: ResetPasswordUseCase,
    private readonly startSocialLogin: StartSocialLoginUseCase,
    private readonly socialLoginCallback: SocialLoginCallbackUseCase,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Creates an account and sends the verification email',
    description:
      'Responds 202 for both a new address and an already-registered one — ' +
      "the response doesn't reveal whether the account exists. In the second " +
      "case nothing is created and the address's owner gets a notice.",
  })
  @ApiAcceptedResponse({ type: AceiteResponseDto })
  @ApiForbiddenResponse({
    description: 'Registration closed (AUTH_REGISTRATION_ENABLED=false).',
  })
  @ApiBadRequestResponse({ description: 'Password fails the minimum policy.' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<AceiteResponseDto> {
    await this.registrar.execute({
      email: dto.email,
      senha: dto.senha,
      nome: dto.nome ?? null,
      contexto: contextoDe(req),
    });
    return ACEITE;
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Authenticates and issues the access + refresh pair',
    description:
      'A nonexistent email, wrong password, and a locked account all return ' +
      'exactly the same 401 response — same body, same status.',
  })
  @ApiOkResponse({ type: SessaoResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Email not yet verified.' })
  async login_(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoResponseDto> {
    const sessao = await this.login.execute({
      email: dto.email,
      senha: dto.senha,
      contexto: contextoDe(req),
    });
    return this.responderComCookies(res, sessao);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotates the refresh and issues a new pair',
    description:
      'The presented refresh is consumed. Re-presenting an already-rotated ' +
      'token revokes the WHOLE family and records a security event — even ' +
      'when the cause was a client double-submit.',
  })
  @ApiOkResponse({ type: SessaoResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Refresh invalid, expired, or already used.',
  })
  async refresh_(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoResponseDto> {
    exigirCsrf(req);
    const refreshToken = refreshDoCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh inválido ou expirado.');
    }

    const sessao = await this.refresh.execute({
      refreshToken,
      contexto: contextoDe(req),
    });
    return this.responderComCookies(res, sessao);
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revokes the family of the presented refresh',
    description:
      'Always 204, even for an unknown token — answering 401 here would be a ' +
      'token-validity oracle.',
  })
  @ApiNoContentResponse({
    description: 'Session ended. The session cookies are cleared.',
  })
  async logout_(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    exigirCsrf(req);
    const refreshToken = refreshDoCookie(req);

    // Os cookies caem PRIMEIRO, e mesmo sem token: se a revogação falhar, o
    // browser já esqueceu a sessão. O inverso — revogar e falhar ao limpar —
    // deixaria o usuário com um cookie morto que ele não consegue descartar.
    limparCookiesDeSessao(res);
    if (!refreshToken) return;

    await this.logout.execute({
      refreshToken,
      contexto: contextoDe(req),
    });
  }

  @Post('verify-email')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Confirms the email with the single-use token',
  })
  @ApiBadRequestResponse({
    description:
      'Link invalid, expired, or already used — all three with the same response.',
  })
  @ApiNoContentResponse({
    description: 'Email verified; login already works.',
  })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.verificarEmail.execute({
      token: dto.token,
      contexto: contextoDe(req),
    });
  }

  @Post('request-password-reset')
  @Public()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Requests the password reset link',
    description:
      'Responds 202 for both a known and an unknown address. It is also the ' +
      "path for whoever was imported from Keycloak and hasn't set a password yet.",
  })
  @ApiAcceptedResponse({ type: AceiteResponseDto })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
    @Req() req: Request,
  ): Promise<AceiteResponseDto> {
    await this.pedirReset.execute({
      email: dto.email,
      contexto: contextoDe(req),
    });
    return ACEITE;
  }

  @Post('reset-password')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Sets the new password from the token',
    description:
      "Revokes ALL of the user's sessions. Does not issue tokens: whoever " +
      'resets the password is sent to login, so that compromising the email ' +
      "doesn't equal taking over the account in a single step.",
  })
  @ApiBadRequestResponse({
    description: 'Link invalid/expired, or password fails the policy.',
  })
  @ApiNoContentResponse({
    description:
      "Password set. ALL of the user's live sessions are revoked along with it.",
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.resetar.execute({
      token: dto.token,
      novaSenha: dto.novaSenha,
      contexto: contextoDe(req),
    });
  }

  /**
   * Início do login social (RN-272..286, ADR 0084).
   *
   * `@Public()` pela mesma razão do callback de conexão de git: quem chega é
   * o BROWSER, sem sessão nenhuma da api ainda — é o próprio ponto de
   * entrada. Redireciona direto para o provider, sem corpo JSON no meio: um
   * `<a href>` simples na tela de login basta, sem JavaScript de mais.
   */
  @Get('oauth/:provider/start')
  @Public()
  @ApiParam({ name: 'provider', enum: SOCIAL_PROVIDERS })
  @ApiOperation({
    summary: 'Redirects to the OAuth provider for social login',
    description:
      'The `state` goes signed by HMAC with its OWN purpose — never the git ' +
      "connection-to-project flow's (see ADR 0084).",
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to the provider.',
    headers: {
      Location: {
        description: "The provider's authorization URL.",
        schema: {
          type: 'string',
          example: 'https://github.com/login/oauth/authorize?…',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Provider outside `github`/`gitlab`.' })
  oauthStart(@Param('provider') provider: string, @Res() res: Response): void {
    const { authorizeUrl } = this.startSocialLogin.execute(
      parseSocialProvider(provider),
    );
    res.redirect(302, authorizeUrl);
  }

  /**
   * Recebe o retorno do OAuth de login social e redireciona para a web.
   *
   * Mesmo desenho do `git/oauth/:provider/callback`: pública, `state`
   * verificado por HMAC, e NUNCA responde JSON — um corpo de erro cru numa
   * navegação de browser seria péssima experiência, e o motivo do erro NÃO
   * vaza na URL.
   *
   * O access token não vai na URL nem no corpo: os cookies de sessão são
   * gravados aqui (mesma `definirCookiesDeSessao` do login por senha) e o
   * boot da web (`restaurarSessao()`, chamado em TODA carga de página) já
   * troca o refresh recém-gravado por um access token, sem código novo do
   * lado do cliente.
   */
  @Get('oauth/:provider/callback')
  @Public()
  @ApiParam({ name: 'provider', enum: SOCIAL_PROVIDERS })
  @ApiOperation({
    summary: 'Receives the social login OAuth callback',
    description:
      'Success goes to `WEB_ORIGIN/` already with the session cookies set; ' +
      'failure goes to `WEB_ORIGIN/login?oauth_error=1`, without detailing the reason.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to the web app.',
    headers: {
      Location: {
        description: 'Destination on the web app.',
        schema: {
          type: 'string',
          example: 'http://localhost:5173/',
        },
      },
    },
  })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    const apiPublicUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';

    try {
      const parsedProvider = parseSocialProvider(provider);
      const redirectUri = `${apiPublicUrl}/auth/oauth/${parsedProvider}/callback`;
      const sessao = await this.socialLoginCallback.execute(
        parsedProvider,
        code,
        state,
        redirectUri,
        contextoDe(req),
      );
      definirCookiesDeSessao(
        res,
        sessao.refreshToken,
        authConfig.refreshTtlMs(),
      );
      res.redirect(302, `${webOrigin}/`);
    } catch {
      // Navegação de browser vindo do provider — ver o docblock do
      // `git.controller.ts#callback`, mesmo raciocínio.
      res.redirect(302, `${webOrigin}/login?oauth_error=1`);
    }
  }

  /**
   * Manda o refresh pelo cookie e devolve só o access no corpo.
   *
   * Devolver o refresh nos dois lugares anularia o `httpOnly`: bastaria o XSS
   * ler a resposta. Por isso `SessaoResponseDto` perdeu o campo.
   */
  private responderComCookies(
    res: Response,
    sessao: {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      locale: string;
    },
  ): SessaoResponseDto {
    definirCookiesDeSessao(res, sessao.refreshToken, authConfig.refreshTtlMs());
    return {
      accessToken: sessao.accessToken,
      expiresIn: sessao.expiresIn,
      locale: sessao.locale,
    };
  }
}

/**
 * IP e user agent do cliente.
 *
 * O `X-Forwarded-For` é lido explicitamente, do mesmo jeito e pelo mesmo
 * motivo que em `rate-limit.guard.ts`: sem `trust proxy`, atrás do Ingress
 * toda requisição chegaria com o IP do proxy e o balde de IP viraria um balde
 * global — que bloquearia todo mundo junto no primeiro ataque.
 */
function contextoDe(req: Request): ContextoDaRequisicao {
  const encaminhado = req.headers['x-forwarded-for'];
  const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
  const ip =
    bruto?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress || null;

  return { ip, userAgent: req.headers['user-agent'] ?? null };
}
