import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { definirCookiesDeSessao } from '../auth/session-cookies';
import { authConfig } from '../../../application/use-cases/auth/auth-config';
import {
  AcessoRapidoUseCase,
  emailDoPapel,
} from '../../../application/use-cases/acesso-rapido/acesso-rapido.use-case';
import { ROLE_ORDER } from '../../../domain/iam/role';
import { SessaoResponseDto } from '../auth/dto/auth.dto';
import {
  AcessoRapidoDto,
  PapeisDoAcessoRapidoResponseDto,
} from './acesso-rapido.dto';

/**
 * Só existe com o ambiente `local` (`AcessoRapidoHttpModule.registrar`). Fora
 * dele a rota não é montada: 404. Mesma postura do `/auth/login`: `@Public`,
 * sem CSRF (não há sessão a proteger) e sem rate limit (a defesa é a rota não
 * existir fora de `local`).
 */
@ApiTags('auth')
@Controller('auth/dev-login')
export class AcessoRapidoController {
  constructor(private readonly acessoRapido: AcessoRapidoUseCase) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Lists the roles available for quick access' })
  @ApiOkResponse({ type: PapeisDoAcessoRapidoResponseDto })
  papeis(): PapeisDoAcessoRapidoResponseDto {
    return {
      papeis: [...ROLE_ORDER]
        .reverse()
        .map((papel) => ({ papel, email: emailDoPapel(papel) })),
    };
  }

  @Post()
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Issues a session for the chosen role (local environment only)',
  })
  @ApiOkResponse({ type: SessaoResponseDto })
  async entrar(
    @Body() dto: AcessoRapidoDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessaoResponseDto> {
    const encaminhado = req.headers['x-forwarded-for'];
    const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado;
    const sessao = await this.acessoRapido.execute(dto.papel, {
      ip: bruto?.split(',')[0]?.trim() || req.ip || null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    definirCookiesDeSessao(res, sessao.refreshToken, authConfig.refreshTtlMs());
    return {
      accessToken: sessao.accessToken,
      expiresIn: sessao.expiresIn,
      locale: sessao.locale,
    };
  }
}
