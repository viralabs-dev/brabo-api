import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { IssuePersonalAccessTokenUseCase } from '../../../application/use-cases/auth/issue-personal-access-token.use-case';
import { ListPersonalAccessTokensUseCase } from '../../../application/use-cases/auth/list-personal-access-tokens.use-case';
import { RevokePersonalAccessTokenUseCase } from '../../../application/use-cases/auth/revoke-personal-access-token.use-case';
import { ListPersonalAccessTokensAsMaintainerUseCase } from '../../../application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case';
import { RevokePersonalAccessTokenAsMaintainerUseCase } from '../../../application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case';
import { IssuePatRequestDto } from './dto/issue-pat.request.dto';
import { IssuePatResponseDto } from './dto/issue-pat.response.dto';
import { PersonalAccessTokenResponseDto } from './dto/personal-access-token.response.dto';
import { PersonalAccessTokenAdminResponseDto } from './dto/personal-access-token-admin.response.dto';

/**
 * Gestão de Personal Access Tokens do runner (ADR 0105, RN-424/425/426).
 *
 * Papel mínimo `developer` nas três rotas de self-service — a mesma régua de
 * `runner-ticket` (`RunnerTicketsController`): emitir um PAT não pode ser
 * mais fácil que usar a capacidade que ele concede. Cada usuário só gerencia
 * os PRÓPRIOS tokens por essas rotas.
 *
 * As duas rotas `/all`/`/:tokenId/admin` são a extensão de `maintainer`
 * (RN-427) — resposta a incidente (dev desligado com token vazando),
 * declarada fora de escopo no ADR 0105 e fechada aqui. Rotas SEPARADAS, não
 * um `if` dentro dos handlers de self-service: mesmo princípio já usado no
 * resto do produto para autorização por nível (`OfferInfraHandoffUseCase`,
 * por exemplo).
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto não encontrado.' })
@Controller('projects/:projectId/personal-access-tokens')
export class PersonalAccessTokensController {
  constructor(
    private readonly issue: IssuePersonalAccessTokenUseCase,
    private readonly list: ListPersonalAccessTokensUseCase,
    private readonly revoke: RevokePersonalAccessTokenUseCase,
    private readonly listAsMaintainer: ListPersonalAccessTokensAsMaintainerUseCase,
    private readonly revokeAsMaintainer: RevokePersonalAccessTokenAsMaintainerUseCase,
  ) {}

  @Post()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Emite um Personal Access Token pro runner local',
    description:
      'O token bruto (`brb_...`) só aparece NESTA resposta — não fica ' +
      'recuperável depois, só o hash é guardado. Use em `--token`/' +
      '`BRABO_ACCOUNT_TOKEN` do `brabo-runner`.',
  })
  @ApiCreatedResponse({ type: IssuePatResponseDto })
  issuePat(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Body() dto: IssuePatRequestDto,
  ) {
    return this.issue.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      expiresInDays: dto.expiresInDays,
    });
  }

  @Get()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Lista os próprios Personal Access Tokens deste projeto',
    description: 'Nunca inclui o token bruto — só o que já foi emitido.',
  })
  @ApiOkResponse({ type: [PersonalAccessTokenResponseDto] })
  listPats(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.list.execute(user.id, projectId);
  }

  @Delete(':tokenId')
  @RequireRole('developer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga um Personal Access Token próprio',
    description: 'Idempotente — revogar de novo não é erro.',
  })
  @ApiNoContentResponse({ description: 'Token revogado. Sem corpo.' })
  async revokePat(
    @Param('projectId') _projectId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.revoke.execute(tokenId, user.id);
  }

  @Get('all')
  @RequireRole('maintainer')
  @ApiOperation({
    summary:
      'Lista TODOS os Personal Access Tokens do projeto, de qualquer usuário',
    description:
      'Visão de `maintainer` para resposta a incidente (RN-427) — inclui ' +
      'o dono de cada token. Nunca inclui o token bruto.',
  })
  @ApiOkResponse({ type: [PersonalAccessTokenAdminResponseDto] })
  listAllPats(@Param('projectId') projectId: string) {
    return this.listAsMaintainer.execute(projectId);
  }

  @Delete(':tokenId/admin')
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revoga o Personal Access Token de QUALQUER usuário no projeto',
    description:
      'Resposta a incidente — dev desligado com token vazando (RN-427). ' +
      'Idempotente — revogar de novo não é erro.',
  })
  @ApiNoContentResponse({ description: 'Token revogado. Sem corpo.' })
  async revokePatAsMaintainer(
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.revokeAsMaintainer.execute(tokenId, projectId);
  }
}
