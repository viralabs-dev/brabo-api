import { Controller, Get, Param } from '@nestjs/common';
import { RequireRole } from '../iam/require-role.decorator';
import { ListBacklogUseCase } from '../../../application/use-cases/backlog/list-backlog.use-case';
import { GetCoverageUseCase } from '../../../application/use-cases/backlog/get-coverage.use-case';

/**
 * Leitura do backlog do projeto (Fase 3b): a árvore épico→história→tarefa e a
 * rastreabilidade regra→stories (cobertura). Nível de projeto — o PO escreve
 * via endpoints internos; aqui só leitura pra a tab Backlog.
 */
@Controller('projects/:projectId')
export class BacklogController {
  constructor(
    private readonly listBacklog: ListBacklogUseCase,
    private readonly getCoverage: GetCoverageUseCase,
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
}
