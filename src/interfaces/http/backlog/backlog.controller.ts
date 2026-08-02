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
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto inexistente.' })
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
    summary: 'Devolve a árvore épico → história → tarefa',
    description:
      'Aninhada e completa, numa chamada só. É LEITURA: quem escreve backlog são ' +
      'os agentes, pelas rotas `/internal/*`.',
  })
  @ApiOkResponse({ type: [EpicComHistoriasResponseDto] })
  backlog(@Param('projectId') projectId: string) {
    return this.listBacklog.execute(projectId);
  }

  @Get('coverage')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Calcula a cobertura regra de negócio → histórias',
    description:
      'Cruza as regras do projeto com o `businessRuleIds` das histórias. Regra sem ' +
      'história nenhuma é uma DESCOBERTA — pendência do PO, não erro.',
  })
  @ApiOkResponse({ type: CoverageReportResponseDto })
  coverage(@Param('projectId') projectId: string) {
    return this.getCoverage.execute(projectId);
  }

  @Get('architecture')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Devolve o module_map vigente, as ADRs e as pendências',
    description:
      'O mapa vigente é o de maior `version` (o histórico é imutável). As pendências ' +
      'são a validação cruzada história↔mapa: história sem módulo, ou apontando um ' +
      'módulo que não existe.',
  })
  @ApiOkResponse({ type: ArchitectureResponseDto })
  architecture(@Param('projectId') projectId: string) {
    return this.getArchitecture.execute(projectId);
  }

  @Get('infra-artifacts')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lista as PRs de infra e o estágio de gate de cada uma',
    description:
      'Artefatos do InfraAgent (Dockerfile, compose, CI). Passam pelos MESMOS gates ' +
      'de QA e SecOps das PRs de dev, sem task nem worktree por trás.',
  })
  @ApiOkResponse({ type: [InfraArtifactResponseDto] })
  infraArtifacts(@Param('projectId') projectId: string) {
    return this.listInfraArtifacts.execute(projectId);
  }

  @Post('stories/promote')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Promove a `ready` as histórias que o PO propôs',
    description:
      'O passo humano que o modo `manual` (default desde a Fase 12c) devolve ' +
      'ao usuário: até promover, NENHUMA tarefa da história é pegável por dev ' +
      'agent nenhum. Promover libera o lote de tarefas de uma vez e acorda os ' +
      'agentes idle do módulo (Fase 12b). O lote NÃO é all-or-nothing — o que ' +
      'não passou volta em `failed` com o motivo, e o que passou está promovido.',
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
    summary: 'Devolve ao PO uma história recusada, com o motivo',
    description:
      'A história sai da fila de propostas e o motivo vira mensagem fixada na ' +
      'sessão do PO — mesmo padrão da devolução de um gate ao dev. Se o PO ' +
      'daquela sessão não estiver mais de pé, a devolução é gravada assim ' +
      'mesmo: a decisão é do usuário e não depende de haver agente ouvindo.',
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
