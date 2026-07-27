import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { GetCoverageUseCase } from '../../../application/use-cases/backlog/get-coverage.use-case';
import { GetArchitectureUseCase } from '../../../application/use-cases/architecture/get-architecture.use-case';
import { ListInfraArtifactsUseCase } from '../../../application/use-cases/execution/list-infra-artifacts.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  ArchitectureResponseDto,
  CoverageReportResponseDto,
  EpicComHistoriasResponseDto,
  InfraArtifactResponseDto,
} from './dto/backlog.response.dto';

/**
 * Leitura do backlog + arquitetura do projeto (Fase 3b): a árvore
 * épico→história→tarefa, a rastreabilidade regra→stories (cobertura), e a seção
 * de arquitetura (module_map + ADRs + pendências de validação cruzada). Nível
 * de projeto — os agentes escrevem via endpoints internos; aqui só leitura.
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
}
