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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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
import { GetRepoBootstrapStatusUseCase } from '../../../application/use-cases/git/get-repo-bootstrap-status.use-case';
import { ProvisionRepositoryDto } from './dto/provision-repository.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  GitAuthorizeUrlResponseDto,
  ProvisionRepositoryResponseDto,
  ProvisionedRepositoryResponseDto,
  RepoBootstrapStatusResponseDto,
} from './dto/git.response.dto';

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

/**
 * O `@ApiBearerAuth` é POR ROTA aqui, e não na classe, porque o callback de
 * OAuth é `@Public()`: uma declaração de classe vazaria para ele e a
 * referência afirmaria que o browser precisa de token para voltar do provider.
 * Nenhum decorator do @nestjs/swagger LIMPA uma exigência herdada, então a
 * única saída correta é não herdar.
 */
@ApiTags('git')
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto inexistente.' })
@Controller()
export class GitController {
  constructor(
    private readonly startOauth: StartGitOauthUseCase,
    private readonly handleCallback: HandleGitOauthCallbackUseCase,
    private readonly provisionRepository: ProvisionRepositoryUseCase,
    private readonly getRepository: GetProvisionedRepositoryUseCase,
    private readonly getBootstrapStatus: GetRepoBootstrapStatusUseCase,
  ) {}

  @Get('projects/:projectId/git/:provider/connect')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiParam({ name: 'provider', enum: ['github', 'gitlab'] })
  @ApiOperation({
    summary: 'Começa o OAuth com o provider de git',
    description:
      'Não redireciona: devolve a URL para o cliente decidir quando mandar o browser. ' +
      'O `state` vai assinado por HMAC, e é o que impede o callback de ser forjado.',
  })
  @ApiOkResponse({ type: GitAuthorizeUrlResponseDto })
  @ApiBadRequestResponse({ description: 'Provider fora de `github`/`gitlab`.' })
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
  @ApiParam({ name: 'provider', enum: ['github', 'gitlab'] })
  @ApiOperation({
    summary: 'Recebe o retorno do OAuth e redireciona para a web',
    description:
      'Pública porque quem chega é o BROWSER do usuário vindo do provider, sem sessão ' +
      'da api. Não é irrestrita: o `state` é verificado por HMAC e sem ele válido a ' +
      'chamada é recusada. Nunca responde JSON — sempre redireciona, porque um corpo ' +
      'de erro cru numa navegação de browser seria péssima experiência.',
  })
  @ApiResponse({
    status: 302,
    description:
      'Sucesso vai para `WEB_ORIGIN/projects/:id?git=connected`; falha vai para ' +
      '`WEB_ORIGIN/git-error`. O erro NÃO vaza o motivo na URL.',
    headers: {
      Location: {
        description: 'Destino na web.',
        schema: {
          type: 'string',
          example: 'http://localhost:5173/projects/01JC…?git=connected',
        },
      },
    },
  })
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
  @ApiBearerAuth(BEARER)
  @ApiParam({ name: 'provider', enum: ['local', 'github', 'gitlab'] })
  @ApiOperation({
    summary: 'Cria o repositório e dispara o bootstrap de Gitflow',
    description:
      'A resposta volta assim que o repositório existe; o bootstrap (branches ' +
      'permanentes, proteções, templates) continua em segundo plano e é ' +
      'IDEMPOTENTE E RETOMÁVEL. Acompanhe por `GET /projects/:id/git/bootstrap`.',
  })
  @ApiCreatedResponse({ type: ProvisionRepositoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Provider inválido, ou credencial ausente.',
  })
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
  @ApiBearerAuth(BEARER)
  @ApiOperation({ summary: 'Devolve o repositório provisionado do projeto' })
  @ApiOkResponse({ type: ProvisionedRepositoryResponseDto })
  get(@Param('projectId') projectId: string) {
    return this.getRepository.execute(projectId);
  }

  @Get('projects/:projectId/git/bootstrap')
  @RequireRole('viewer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Devolve o estado do bootstrap de Gitflow',
    description:
      'Em que passo está, se falhou e onde, e quantas tentativas houve. O detalhe ' +
      'passo a passo vem dos eventos `bootstrap.step_*` da sessão dedicada.',
  })
  @ApiOkResponse({ type: RepoBootstrapStatusResponseDto })
  getBootstrap(@Param('projectId') projectId: string) {
    return this.getBootstrapStatus.execute(projectId);
  }
}
