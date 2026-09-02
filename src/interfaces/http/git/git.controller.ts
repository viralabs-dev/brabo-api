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
import { AdoptRepositoryUseCase } from '../../../application/use-cases/git/adopt-repository.use-case';
import { DecideBootstrapPlanUseCase } from '../../../application/use-cases/git/decide-bootstrap-plan.use-case';
import { GetBootstrapPlanUseCase } from '../../../application/use-cases/git/get-bootstrap-plan.use-case';
import { AcknowledgeProtectionFailureUseCase } from '../../../application/use-cases/git/acknowledge-protection-failure.use-case';
import { ProvisionRepositoryDto } from './dto/provision-repository.dto';
import { AdoptRepositoryDto } from './dto/adopt-repository.dto';
import { DecideBootstrapPlanDto } from './dto/decide-bootstrap-plan.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  AdoptRepositoryResponseDto,
  BootstrapPlanEstadoResponseDto,
  DecideBootstrapPlanResponseDto,
  GitAuthorizeUrlResponseDto,
  ProvisionRepositoryResponseDto,
  ProvisionedRepositoryResponseDto,
  ReconhecerFalhaDeProtecaoResponseDto,
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
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project does not exist.' })
@Controller()
export class GitController {
  constructor(
    private readonly startOauth: StartGitOauthUseCase,
    private readonly handleCallback: HandleGitOauthCallbackUseCase,
    private readonly provisionRepository: ProvisionRepositoryUseCase,
    private readonly getRepository: GetProvisionedRepositoryUseCase,
    private readonly getBootstrapStatus: GetRepoBootstrapStatusUseCase,
    private readonly adoptRepository: AdoptRepositoryUseCase,
    private readonly decideBootstrapPlan: DecideBootstrapPlanUseCase,
    private readonly getPlan: GetBootstrapPlanUseCase,
    private readonly acknowledgeProtectionFailure: AcknowledgeProtectionFailureUseCase,
  ) {}

  @Get('projects/:projectId/git/:provider/connect')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiParam({ name: 'provider', enum: ['github', 'gitlab'] })
  @ApiOperation({
    summary: 'Starts OAuth with the git provider',
    description:
      "Doesn't redirect: returns the URL for the client to decide when to send " +
      'the browser. The `state` goes signed by HMAC, and that is what prevents ' +
      'the callback from being forged.',
  })
  @ApiOkResponse({ type: GitAuthorizeUrlResponseDto })
  @ApiBadRequestResponse({ description: 'Provider outside `github`/`gitlab`.' })
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
    summary: 'Receives the OAuth return and redirects to the web app',
    description:
      "Public because whoever arrives is the user's BROWSER coming from the " +
      "provider, without an api session. It isn't unrestricted: the `state` " +
      'is verified by HMAC and without a valid one the call is refused. Never ' +
      'responds with JSON — always redirects, because a raw error body in a ' +
      'browser navigation would be a terrible experience.',
  })
  @ApiResponse({
    status: 302,
    description:
      'Success goes to `WEB_ORIGIN/projects/:id?git=connected`; failure goes ' +
      'to `WEB_ORIGIN/git-error`. The error does NOT leak the reason in the URL.',
    headers: {
      Location: {
        description: 'Destination on the web app.',
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
    summary: 'Creates the repository and runs the Gitflow bootstrap',
    description:
      'SYNCHRONOUS: the response only comes back after the whole bootstrap ' +
      '(permanent branches, protections, templates) has run — there is no ' +
      'worker and no queue behind this. It is IDEMPOTENT AND RESUMABLE, so ' +
      'calling it again after a failure resumes from the step that failed. ' +
      'Track progress and read the failure reason via ' +
      '`GET /projects/:id/git/bootstrap`.',
  })
  @ApiCreatedResponse({ type: ProvisionRepositoryResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid provider, or missing credential.',
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

  @Post('projects/:projectId/git/:provider/repository/adopt')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiParam({ name: 'provider', enum: ['local', 'github', 'gitlab'] })
  @ApiOperation({
    summary: 'Adopts an existing repository, without creating anything',
    description:
      'Validates access with `getRepo` and produces a PLAN (dry-run) of what ' +
      'the bootstrap would do — missing branches, missing protections, files. ' +
      'NOTHING is executed on the repository: decide afterward via ' +
      '`plan/approve` or `plan/skip`. Re-adopting the same repository ' +
      'converges (regenerates the plan without duplicating a row).',
  })
  @ApiCreatedResponse({ type: AdoptRepositoryResponseDto })
  @ApiNotFoundResponse({
    description:
      "The repository doesn't exist on the provider — check the identifier.",
  })
  @ApiForbiddenResponse({
    description:
      "The repository exists, but the registered credential can't reach it.",
  })
  adopt(
    @Param('projectId') projectId: string,
    @Param('provider') provider: string,
    @Body() dto: AdoptRepositoryDto,
    @CurrentUser() user: User,
  ) {
    return this.adoptRepository.execute(projectId, user.id, {
      ...dto,
      provider: parseGitProvider(provider),
    });
  }

  @Get('projects/:projectId/git/bootstrap/plan')
  @RequireRole('viewer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Returns the bootstrap plan and what was decided about it',
    description:
      '`decision: null` with a plan present is the state where NOTHING runs ' +
      '— waiting for approval or as-is adoption (RN-045).',
  })
  @ApiOkResponse({ type: BootstrapPlanEstadoResponseDto })
  plan(@Param('projectId') projectId: string) {
    return this.getPlan.execute(projectId);
  }

  @Post('projects/:projectId/git/bootstrap/plan/approve')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Approves the WHOLE plan and runs the bootstrap',
    description:
      'Approval is all-or-nothing: approving loose steps would break the ' +
      '`dev←main, qa←dev, rc←qa` cascade. What runs is the plan RE-DERIVED at ' +
      'execution time — equal to or smaller than what was shown, never larger.',
  })
  @ApiCreatedResponse({ type: DecideBootstrapPlanResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'The plan was regenerated since you last saw it, or it had already been decided.',
  })
  approvePlan(
    @Param('projectId') projectId: string,
    @Body() dto: DecideBootstrapPlanDto,
    @CurrentUser() user: User,
  ) {
    return this.decideBootstrapPlan.approve(projectId, user.id, dto);
  }

  @Post('projects/:projectId/git/bootstrap/plan/skip')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Adopts the repository AS IS, dismissing the bootstrap',
    description:
      "Records the decision and doesn't touch the repository. The plan " +
      'stays stored as evidence of what was deliberately not applied, and ' +
      'the bootstrap cursor is NOT tampered with — no step ran.',
  })
  @ApiCreatedResponse({ type: DecideBootstrapPlanResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'The plan was regenerated since you last saw it, or it had already been decided.',
  })
  skipPlan(
    @Param('projectId') projectId: string,
    @Body() dto: DecideBootstrapPlanDto,
    @CurrentUser() user: User,
  ) {
    return this.decideBootstrapPlan.adoptAsIs(projectId, user.id, dto);
  }

  @Post('projects/:projectId/git/bootstrap/acknowledge-protection-failure')
  @RequireRole('maintainer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Acknowledges the branch-protection failure and moves on',
    description:
      '`protect_branches` fails on a private repository on the free plan, ' +
      'and the wizard warns about this BEFOREHAND. Without this exit the ' +
      'only button was "Try again", which always fails for the same reason ' +
      '— and `provision_failed` makes the dashboard redirect the project ' +
      'back to the provisioning page, leaving it unreachable forever. Only a ' +
      'failure in PROTECTING can be acknowledged: it is the last step and ' +
      'the only one whose failure leaves a usable repository. The ' +
      "product's merge lock (RN-006) doesn't depend on the provider's " +
      'protection and keeps applying.',
  })
  @ApiCreatedResponse({ type: ReconhecerFalhaDeProtecaoResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'The bootstrap did not fail, or it failed on a step before protection ' +
      '— moving on there would leave the project without a usable repository.',
  })
  reconhecerFalhaDeProtecao(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.acknowledgeProtectionFailure.execute(projectId, user.id);
  }

  @Get('projects/:projectId/git/repository')
  @RequireRole('viewer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({ summary: "Returns the project's provisioned repository" })
  @ApiOkResponse({ type: ProvisionedRepositoryResponseDto })
  get(@Param('projectId') projectId: string) {
    return this.getRepository.execute(projectId);
  }

  @Get('projects/:projectId/git/bootstrap')
  @RequireRole('viewer')
  @ApiBearerAuth(BEARER)
  @ApiOperation({
    summary: 'Returns the Gitflow bootstrap state',
    description:
      'Which step it is on, whether it failed and where, and how many ' +
      'attempts there were. The step-by-step detail comes from the ' +
      '`bootstrap.step_*` events of the dedicated session.',
  })
  @ApiOkResponse({ type: RepoBootstrapStatusResponseDto })
  getBootstrap(@Param('projectId') projectId: string) {
    return this.getBootstrapStatus.execute(projectId);
  }
}
