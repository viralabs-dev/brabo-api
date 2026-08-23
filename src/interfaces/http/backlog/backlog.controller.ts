import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { GetCoverageUseCase } from '../../../application/use-cases/backlog/get-coverage.use-case';
import { PromoteStoriesUseCase } from '../../../application/use-cases/backlog/promote-stories.use-case';
import { ReturnStoryUseCase } from '../../../application/use-cases/backlog/return-story.use-case';
import { GetArchitectureUseCase } from '../../../application/use-cases/architecture/get-architecture.use-case';
import { ListInfraArtifactsUseCase } from '../../../application/use-cases/execution/list-infra-artifacts.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import {
  ArchitectureResponseDto,
  CoverageReportResponseDto,
  EpicComHistoriasResponseDto,
  InfraArtifactResponseDto,
} from './dto/backlog.response.dto';
import {
  PromoteStoriesDto,
  PromoteStoriesResponseDto,
  ReturnStoryDto,
} from './dto/promote-stories.dto';

/**
 * Backlog + arquitetura do projeto (Fase 3b): a árvore épico→história→tarefa,
 * a rastreabilidade regra→stories (cobertura), e a seção de arquitetura
 * (module_map + ADRs + pendências de validação cruzada).
 *
 * Era só leitura até a Fase 12c — quem escrevia backlog eram os agentes, pelas
 * rotas `/internal/*`. As duas rotas de escrita que existem aqui são as ÚNICAS
 * decisões de backlog que pertencem ao usuário e não a um agente: promover uma
 * história proposta, ou devolvê-la ao PO (RN-048).
 */
@ApiTags('backlog')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project does not exist.' })
@Controller('projects/:projectId')
export class BacklogController {
  constructor(
    private readonly listBacklog: ListBacklogUseCase,
    private readonly getCoverage: GetCoverageUseCase,
    private readonly getArchitecture: GetArchitectureUseCase,
    private readonly listInfraArtifacts: ListInfraArtifactsUseCase,
    private readonly promoteStories: PromoteStoriesUseCase,
    private readonly returnStory: ReturnStoryUseCase,
  ) {}

  @Get('backlog')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Returns the epic → story → task tree',
    description:
      'Nested and complete, in a single call. This is READ-ONLY: backlog is ' +
      'written by agents, through the `/internal/*` routes.',
  })
  @ApiOkResponse({ type: [EpicComHistoriasResponseDto] })
  backlog(@Param('projectId') projectId: string) {
    return this.listBacklog.execute(projectId);
  }

  @Get('coverage')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Computes business-rule → stories coverage',
    description:
      "Cross-references the project's rules with the stories' " +
      '`businessRuleIds`. A rule with no story at all is a DISCOVERY — a ' +
      "pending item for the PO, not an error.",
  })
  @ApiOkResponse({ type: CoverageReportResponseDto })
  coverage(@Param('projectId') projectId: string) {
    return this.getCoverage.execute(projectId);
  }

  @Get('architecture')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Returns the current module_map, the ADRs, and the pending items',
    description:
      'The current map is the one with the highest `version` (history is ' +
      'immutable). The pending items are the story↔map cross-validation: a ' +
      "story with no module, or pointing at a module that doesn't exist.",
  })
  @ApiOkResponse({ type: ArchitectureResponseDto })
  architecture(@Param('projectId') projectId: string) {
    return this.getArchitecture.execute(projectId);
  }

  @Get('infra-artifacts')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists infra PRs and the gate stage of each one',
    description:
      "InfraAgent's artifacts (Dockerfile, compose, CI). They go through the " +
      'SAME QA and SecOps gates as dev PRs, with no task or worktree behind them.',
  })
  @ApiOkResponse({ type: [InfraArtifactResponseDto] })
  infraArtifacts(@Param('projectId') projectId: string) {
    return this.listInfraArtifacts.execute(projectId);
  }

  @Post('stories/promote')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Promotes stories the PO proposed to `ready`',
    description:
      'The human step that `manual` mode (default since Phase 12c) hands ' +
      'back to the user: until promotion, NO task from the story is pickable ' +
      'by any dev agent. Promoting releases the batch of tasks at once and ' +
      'wakes up the idle agents of the module (Phase 12b). The batch is NOT ' +
      "all-or-nothing — whatever didn't pass comes back as `failed` with the " +
      'reason, and whatever passed is promoted.',
  })
  @ApiCreatedResponse({ type: PromoteStoriesResponseDto })
  promote(
    @Param('projectId') projectId: string,
    @Body() dto: PromoteStoriesDto,
    @CurrentUser() user: User,
  ) {
    return this.promoteStories.execute(projectId, dto.storyIds, user.id);
  }

  @Post('stories/:storyId/return')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Returns a refused story to the PO, with the reason',
    description:
      "The story leaves the proposal queue and the reason becomes a message " +
      "pinned to the PO's session — the same pattern as returning a gate to " +
      "dev. If that session's PO is no longer up, the return is recorded " +
      "anyway: it's the user's decision and does not depend on an agent " +
      'listening.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  return(
    @Param('projectId') projectId: string,
    @Param('storyId') storyId: string,
    @Body() dto: ReturnStoryDto,
    @CurrentUser() user: User,
  ) {
    return this.returnStory.execute(projectId, storyId, dto.reason, user.id);
  }
}
