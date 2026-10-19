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
@ApiTags('projects')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project not found.' })
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
    summary: 'Issues a Personal Access Token for the local runner',
    description:
      'The raw token (`brb_...`) appears only in THIS response — it is not ' +
      'recoverable later, only the hash is stored. Use it in `--token`/' +
      '`BRABO_ACCOUNT_TOKEN` of `brabo-runner`.',
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
    summary: 'Lists your own Personal Access Tokens for this project',
    description: 'Never includes the raw token — only what was already issued.',
  })
  @ApiOkResponse({ type: [PersonalAccessTokenResponseDto] })
  listPats(@Param('projectId') projectId: string, @CurrentUser() user: User) {
    return this.list.execute(user.id, projectId);
  }

  @Delete(':tokenId')
  @RequireRole('developer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revokes one of your own Personal Access Tokens',
    description:
      'Idempotent — revoking again is not an error. Since RN-685 (ADR 0201) ' +
      'it also DROPS the runner connections opened with THIS token, and only ' +
      "those — the same user's device key stays up —, and voids its " +
      'still-unused tickets. The engine being down does NOT make the ' +
      'revocation fail.',
  })
  @ApiNoContentResponse({ description: 'Token revoked. No body.' })
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
    summary: 'Lists ALL Personal Access Tokens of the project, from any user',
    description:
      'The `maintainer` view for incident response (RN-427) — includes ' +
      'the owner of each token. Never includes the raw token.',
  })
  @ApiOkResponse({ type: [PersonalAccessTokenAdminResponseDto] })
  listAllPats(@Param('projectId') projectId: string) {
    return this.listAsMaintainer.execute(projectId);
  }

  @Delete(':tokenId/admin')
  @RequireRole('maintainer')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Revokes the Personal Access Token of ANY user in the project',
    description:
      'Incident response — a departed dev with a leaking token (RN-427). ' +
      'Idempotent — revoking again is not an error. Since RN-685 (ADR 0201) ' +
      'it also DROPS the runner already connected with this token, and only it.',
  })
  @ApiNoContentResponse({ description: 'Token revoked. No body.' })
  async revokePatAsMaintainer(
    @Param('projectId') projectId: string,
    @Param('tokenId') tokenId: string,
  ): Promise<void> {
    await this.revokeAsMaintainer.execute(tokenId, projectId);
  }
}
