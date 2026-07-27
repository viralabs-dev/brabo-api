import { Controller, Get, Param } from '@nestjs/common';
import { RequireRole } from '../iam/require-role.decorator';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { GetCoverageUseCase } from '../../../application/use-cases/backlog/get-coverage.use-case';
import { GetArchitectureUseCase } from '../../../application/use-cases/architecture/get-architecture.use-case';
import { ListInfraArtifactsUseCase } from '../../../application/use-cases/execution/list-infra-artifacts.use-case';

/**
 * Leitura do backlog + arquitetura do projeto (Fase 3b): a árvore
 * épico→história→tarefa, a rastreabilidade regra→stories (cobertura), e a seção
 * de arquitetura (module_map + ADRs + pendências de validação cruzada). Nível
 * de projeto — os agentes escrevem via endpoints internos; aqui só leitura.
 */
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
  backlog(@Param('projectId') projectId: string) {
    return this.listBacklog.execute(projectId);
  }

  @Get('coverage')
  @RequireRole('viewer')
  coverage(@Param('projectId') projectId: string) {
    return this.getCoverage.execute(projectId);
  }

  @Get('architecture')
  @RequireRole('viewer')
  architecture(@Param('projectId') projectId: string) {
    return this.getArchitecture.execute(projectId);
  }

  @Get('infra-artifacts')
  @RequireRole('viewer')
  infraArtifacts(@Param('projectId') projectId: string) {
    return this.listInfraArtifacts.execute(projectId);
  }
}
