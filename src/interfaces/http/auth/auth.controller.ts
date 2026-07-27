import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from './public.decorator';
import { LoginUseCase } from '../../../application/use-cases/auth/login.use-case';
import { LogoutUseCase } from '../../../application/use-cases/auth/logout.use-case';
import { RefreshUseCase } from '../../../application/use-cases/auth/refresh.use-case';
import { RegisterUseCase } from '../../../application/use-cases/auth/register.use-case';
import { RequestPasswordResetUseCase } from '../../../application/use-cases/auth/request-password-reset.use-case';
import { ResetPasswordUseCase } from '../../../application/use-cases/auth/reset-password.use-case';
import { VerifyEmailUseCase } from '../../../application/use-cases/auth/verify-email.use-case';
import type { ContextoDaRequisicao } from '../../../application/use-cases/auth/auth-config';
import {
  AceiteResponseDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
  RequestPasswordResetDto,
  ResetPasswordDto,
  SessaoResponseDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const ACEITE = {
  message: 'Se o endereço estiver disponível, enviamos um e-mail.',
};

/**
 * Auth first-party (Fase 7a).
 *
 * ## Por que TODAS as rotas são `@Public()`
 *
 * O `JwtAuthGuard` global ainda verifica token do Keycloak nesta fase. Exigir
 * token numa rota de auth pediria um token do Keycloak para fazer login no
 * sistema que veio substituí-lo. A 7.2 revisita o `logout`, que é a única que
 * poderia ser autenticada depois da troca de emissor.
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
  ) {}

  @Post('register')
  @Public()
  @HttpCode(202)
  @ApiOperation({
    summary: 'Cria uma conta e envia o e-mail de verificação',
    description:
      'Responde 202 tanto para endereço novo quanto para endereço já cadastrado — ' +
      'a resposta não revela se a conta existe. No segundo caso nada é criado e o ' +
      'dono do endereço recebe um aviso.',
  })
  @ApiOkResponse({ type: AceiteResponseDto })
  @ApiForbiddenResponse({ description: 'Cadastro fechado (AUTH_REGISTRATION_ENABLED=false).' })
  @ApiBadRequestResponse({ description: 'Senha fora da política mínima.' })
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
    summary: 'Autentica e emite o par access + refresh',
    description:
      'E-mail inexistente, senha errada e conta bloqueada devolvem exatamente a ' +
      'mesma resposta 401 — mesmo corpo, mesmo status.',
  })
  @ApiOkResponse({ type: SessaoResponseDto })
  @ApiUnauthorizedResponse({ description: 'Credenciais inválidas.' })
  @ApiForbiddenResponse({ description: 'E-mail ainda não verificado.' })
  login_(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<SessaoResponseDto> {
    return this.login.execute({
      email: dto.email,
      senha: dto.senha,
      contexto: contextoDe(req),
    });
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotaciona o refresh e emite um par novo',
    description:
      'O refresh apresentado é consumido. Reapresentar um token já rotacionado ' +
      'revoga a FAMÍLIA inteira e registra evento de segurança — inclusive quando ' +
      'a causa foi um duplo-submit do cliente.',
  })
  @ApiOkResponse({ type: SessaoResponseDto })
  @ApiUnauthorizedResponse({ description: 'Refresh inválido, expirado ou já usado.' })
  refresh_(
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ): Promise<SessaoResponseDto> {
    return this.refresh.execute({
      refreshToken: dto.refreshToken,
      contexto: contextoDe(req),
    });
  }

  @Post('logout')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga a família do refresh apresentado',
    description:
      'Sempre 204, inclusive para token desconhecido — responder 401 aqui seria ' +
      'um oráculo de validade de token.',
  })
  async logout_(@Body() dto: RefreshDto, @Req() req: Request): Promise<void> {
    await this.logout.execute({
      refreshToken: dto.refreshToken,
      contexto: contextoDe(req),
    });
  }

  @Post('verify-email')
  @Public()
  @HttpCode(204)
  @ApiOperation({
    summary: 'Confirma o e-mail com o token de uso único',
  })
  @ApiBadRequestResponse({
    description:
      'Link inválido, expirado ou já usado — os três com a mesma resposta.',
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
    summary: 'Pede o link de redefinição de senha',
    description:
      'Responde 202 para endereço conhecido e desconhecido. É também o caminho ' +
      'de quem foi importado do Keycloak e ainda não definiu senha.',
  })
  @ApiOkResponse({ type: AceiteResponseDto })
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
    summary: 'Define a senha nova a partir do token',
    description:
      'Revoga TODAS as sessões do usuário. Não emite tokens: quem redefine a ' +
      'senha é mandado para o login, para comprometer o e-mail não equivaler a ' +
      'tomar a conta em um passo só.',
  })
  @ApiBadRequestResponse({
    description: 'Link inválido/expirado, ou senha fora da política.',
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
    bruto?.split(',')[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    null;

  return { ip, userAgent: req.headers['user-agent'] ?? null };
}
