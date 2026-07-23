import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { GitProviderName } from '@brabo/shared';
import { Public } from '../auth/public.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import type { GitOauthProviderName } from '../../../domain/git/oauth-state';
import { StartGitOauthUseCase } from '../../../application/use-cases/git/start-git-oauth.use-case';
import { HandleGitOauthCallbackUseCase } from '../../../application/use-cases/git/handle-git-oauth-callback.use-case';
import { ProvisionRepositoryUseCase } from '../../../application/use-cases/git/provision-repository.use-case';
import { GetProvisionedRepositoryUseCase } from '../../../application/use-cases/git/get-provisioned-repository.use-case';
import { ProvisionRepositoryDto } from './dto/provision-repository.dto';

const OAUTH_PROVIDERS = ['github', 'gitlab'] as const;
const GIT_PROVIDERS = ['local', 'github', 'gitlab'] as const;

function parseOauthProvider(value: string): GitOauthProviderName {
  if (!OAUTH_PROVIDERS.includes(value as GitOauthProviderName)) {
    throw new BadRequestException(`Provider inválido: ${value}`);
  }
  return value as GitOauthProviderName;
}

function parseGitProvider(value: string): GitProviderName {
  if (!GIT_PROVIDERS.includes(value as GitProviderName)) {
    throw new BadRequestException(`Provider inválido: ${value}`);
  }
  return value as GitProviderName;
}

@Controller()
export class GitController {
  constructor(
    private readonly startOauth: StartGitOauthUseCase,
    private readonly handleCallback: HandleGitOauthCallbackUseCase,
    private readonly provisionRepository: ProvisionRepositoryUseCase,
    private readonly getRepository: GetProvisionedRepositoryUseCase,
  ) {}

  @Get('projects/:projectId/git/:provider/connect')
  @RequireRole('maintainer')
  connect(
    @Param('projectId') projectId: string,
    @Param('provider') provider: string,
    @CurrentUser() user: User,
  ) {
    return this.startOauth.execute(
      projectId,
      user.id,
      parseOauthProvider(provider),
    );
  }

  @Public()
  @Get('git/oauth/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    const apiPublicUrl = process.env.API_PUBLIC_URL ?? 'http://localhost:3000';

    try {
      const parsedProvider = parseOauthProvider(provider);
      const redirectUri = `${apiPublicUrl}/git/oauth/${parsedProvider}/callback`;
      const { projectId } = await this.handleCallback.execute(
        parsedProvider,
        code,
        state,
        redirectUri,
      );
      res.redirect(302, `${webOrigin}/projects/${projectId}?git=connected`);
    } catch {
      // Navegação de browser vindo do provider — resposta JSON crua seria
      // péssima UX aqui, por isso trata localmente em vez de delegar pro
      // filtro HTTP global (que ainda existe como rede de segurança pros
      // outros endpoints desta feature, que são JSON de verdade).
      res.redirect(302, `${webOrigin}/git-error`);
    }
  }

  @Post('projects/:projectId/git/:provider/repository')
  @RequireRole('maintainer')
  provision(
    @Param('projectId') projectId: string,
    @Param('provider') provider: string,
    @Body() dto: ProvisionRepositoryDto,
    @CurrentUser() user: User,
  ) {
    return this.provisionRepository.execute(projectId, user.id, {
      ...dto,
      provider: parseGitProvider(provider),
    });
  }

  @Get('projects/:projectId/git/repository')
  @RequireRole('viewer')
  get(@Param('projectId') projectId: string) {
    return this.getRepository.execute(projectId);
  }
}
