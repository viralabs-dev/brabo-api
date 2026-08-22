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
import { IssuePatRequestDto } from './dto/issue-pat.request.dto';
import { IssuePatResponseDto } from './dto/issue-pat.response.dto';
import { PersonalAccessTokenResponseDto } from './dto/personal-access-token.response.dto';

/**
 * Gestão de Personal Access Tokens do runner (ADR 0105, RN-424/425/426).
 *
 * Papel mínimo `developer` nas três rotas — a mesma régua de `runner-ticket`
 * (`RunnerTicketsController`): emitir um PAT não pode ser mais fácil que
 * usar a capacidade que ele concede. Cada usuário só gerencia os PRÓPRIOS
 * tokens — sem admin cross-user nesta onda (RN-426, decisão declarada).
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
}
