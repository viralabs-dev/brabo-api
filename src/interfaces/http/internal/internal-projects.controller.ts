import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ServiceRoute } from '../auth/service-route.decorator';
import { GetProjectGitRemoteUseCase } from '../../../application/use-cases/git/get-project-git-remote.use-case';
import { ListBusinessRulesUseCase } from '../../../application/use-cases/backlog/list-business-rules.use-case';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { ListProductMetricsUseCase } from '../../../application/use-cases/backlog/list-product-metrics.use-case';
import { ConfirmProjectWorkspaceUseCase } from '../../../application/use-cases/iam/confirm-project-workspace.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import { ProjectGitRemoteResponseDto } from './dto/project-git-remote.response.dto';
import { ProjectBusinessRulesResponseDto } from './dto/internal.response.dto';
import { EpicComHistoriasResponseDto } from '../backlog/dto/backlog.response.dto';
import { ProductMetricsResponseDto } from './dto/product-metrics.response.dto';
import { ConfirmProjectWorkspaceInternalDto } from './dto/confirm-project-workspace-internal.dto';
import { ConfirmProjectWorkspaceResponseDto } from './dto/confirm-project-workspace.response.dto';

/**
 * O que o engine precisa da api sobre um PROJETO — e não sobre uma sessão.
 *
 * Duas famílias moram aqui, e o critério é o mesmo: o recurso é do projeto, e
 * o segmento de sessão seria decorativo.
 *
 * 1. O repositório de trabalho
 *    ([ADR 0056](../../../../../docs/adr/0056-o-engine-trabalha-em-repositorio-remoto.md)).
 *    A divisão é a mesma do sync de catálogo: quem trabalha no sistema de
 *    arquivos é o engine, quem tem as credenciais é a api. Replicar a chave
 *    mestra no engine pouparia uma chamada HTTP e dobraria o raio de explosão
 *    do segredo mais sensível do produto.
 * 2. O que o PO precisa RELER
 *    ([RN-164](../../../../../docs/business-rules.md#rn-164)): as regras de
 *    negócio do projeto, o backlog já escrito e — desde a RN-407 — o
 *    relatório de funil/DORA parcial (`analise:funil`, ADR 0089). O PO só
 *    tinha ferramenta de escrita e lia o contexto uma única vez, no
 *    kickoff — dali em diante não sabia o que existia nem o que ele mesmo
 *    já tinha criado. As três são LEITURA e por isso não viram
 *    `proposed_action`; o que elas devem é ser contidas, e são: escopo
 *    fechado no projeto, sem parâmetro de busca e sem paginação a explorar.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal/projects')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalProjectsController {
  constructor(
    private readonly getGitRemote: GetProjectGitRemoteUseCase,
    private readonly listBusinessRules: ListBusinessRulesUseCase,
    private readonly listBacklog: ListBacklogUseCase,
    private readonly listProductMetrics: ListProductMetricsUseCase,
    private readonly confirmWorkspace: ConfirmProjectWorkspaceUseCase,
  ) {}

  @Get(':projectId/git-remote')
  @ApiOperation({
    summary: "The project's working remote, to fetch and push",
    description:
      'Returns the clean origin (no credential embedded) and, for a remote ' +
      "provider, the workspace OWNER's token (RN-058) decrypted on the fly. " +
      'Whoever consumes it injects the token per invocation and NEVER writes ' +
      'it to a file — `.git/config` sits inside the folder where RN-075 ' +
      'grants the dev agent auto-approved read access.',
  })
  @ApiOkResponse({ type: ProjectGitRemoteResponseDto })
  @ApiNotFoundResponse({
    description:
      "Project with no provisioned repository, or the workspace owner has " +
      'no registered credential for the repository provider.',
  })
  gitRemote(@Param('projectId') projectId: string) {
    return this.getGitRemote.execute(projectId);
  }

  @Get(':projectId/business-rules')
  @ApiOperation({
    summary: "The project's business rules, with coverage, for the PO to read",
    description:
      "Every `artifact.business_rule` from the project's sessions — not " +
      "just the current session's, which was the ceiling of the PO's " +
      'kickoff context — with the full `description` and which stories ' +
      'already cite each rule. `uncoveredCount` is the pending item: a rule ' +
      'no story covers (RN-164). A project with no rule at all responds ' +
      '`200` with an empty list: "no rule captured yet" is not an error.',
  })
  @ApiOkResponse({ type: ProjectBusinessRulesResponseDto })
  businessRules(@Param('projectId') projectId: string) {
    return this.listBusinessRules.execute(projectId);
  }

  @Get(':projectId/backlog')
  @ApiOperation({
    summary: "The project's backlog as a tree, for the PO to read what was already written",
    description:
      'The SAME epic → story → task tree as the Backlog tab, through the ' +
      'same use case (three reads per project, never N+1). It is with this ' +
      'that the PO sees an orphan epic and a story with no task instead of ' +
      're-creating what already exists (RN-164).',
  })
  @ApiOkResponse({ type: [EpicComHistoriasResponseDto] })
  backlog(@Param('projectId') projectId: string) {
    return this.listBacklog.execute(projectId);
  }

  @Get(':projectId/product-metrics')
  @ApiOperation({
    summary: "The project's delivery funnel and partial DORA metrics, for the PO to read",
    description:
      'The SAME report as the `analise:funil` script (ADR 0089) — session → ' +
      'commit → PR → merge funnel, real lead time and real deployment ' +
      'frequency — through the same pure functions and the same query ' +
      '(`apps/api/src/application/services/funil-metrics.ts`), so the two ' +
      "never diverge from the same fact. Closes `docs/fluxo.yml` (role " +
      '`po`, input `metricas-de-produto`, previously `status: lacuna`) ' +
      '(RN-407).',
  })
  @ApiOkResponse({ type: ProductMetricsResponseDto })
  @ApiNotFoundResponse({ description: 'Project does not exist.' })
  productMetrics(@Param('projectId') projectId: string) {
    return this.listProductMetrics.execute(projectId);
  }

  @Post(':projectId/workspace-verification')
  // Reconciles the project's state; does not create an addressable resource.
  @HttpCode(200)
  @ApiOperation({
    summary: 'The runner confirms the path of a "runner" project (RN-423)',
    description:
      'Called only by the engine, after a runner connects and sends ' +
      '`workspace_confirm` over the channel. The runner is the SOURCE OF ' +
      "TRUTH for the path — the api overwrites `workspacePath` with what it " +
      'reported, after re-validating it lexically (system root/overlap with ' +
      'Brabo are still forbidden even coming from the runner). Idempotent: ' +
      'reconnecting with the SAME path writes nothing again.',
  })
  @ApiOkResponse({ type: ConfirmProjectWorkspaceResponseDto })
  @ApiBadRequestResponse({
    description:
      'Lexically invalid path, or the project is not in "runner" mode.',
  })
  @ApiNotFoundResponse({ description: 'Project does not exist.' })
  confirmWorkspaceVerification(
    @Param('projectId') projectId: string,
    @Body() dto: ConfirmProjectWorkspaceInternalDto,
  ) {
    return this.confirmWorkspace.execute(projectId, {
      path: dto.path,
      sessionId: dto.sessionId,
      actorId: dto.actorId,
    });
  }
}
