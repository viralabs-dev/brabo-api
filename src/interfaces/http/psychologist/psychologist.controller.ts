import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ListHypothesesUseCase } from '../../../application/use-cases/execution/list-hypotheses.use-case';
import { AcceptHypothesisUseCase } from '../../../application/use-cases/execution/accept-hypothesis.use-case';
import { DismissHypothesisUseCase } from '../../../application/use-cases/execution/dismiss-hypothesis.use-case';
import { ReanalyzeSessionUseCase } from '../../../application/use-cases/execution/reanalyze-session.use-case';
import { ListPsychologistAnalysesUseCase } from '../../../application/use-cases/execution/list-psychologist-analyses.use-case';

/**
 * Ações humanas sobre as hipóteses do Psicólogo (Fase 4b): listar (seção
 * Insights), aceitar/descartar (ciclo de vida proposed -> accepted |
 * dismissed) e disparar reanálise explícita de uma sessão. Aceitar/
 * descartar NÃO são proposed_actions — o Psicólogo é só leitura, nunca
 * propõe ação com efeito externo.
 */
@Controller('projects/:projectId')
export class PsychologistController {
  constructor(
    private readonly listHypotheses: ListHypothesesUseCase,
    private readonly acceptHypothesis: AcceptHypothesisUseCase,
    private readonly dismissHypothesis: DismissHypothesisUseCase,
    private readonly reanalyzeSession: ReanalyzeSessionUseCase,
    private readonly listAnalyses: ListPsychologistAnalysesUseCase,
  ) {}

  @Get('hypotheses')
  @RequireRole('viewer')
  hypotheses(@Param('projectId') projectId: string) {
    return this.listHypotheses.execute(projectId);
  }

  /**
   * Análises current do projeto com tier e CUSTO — é o que torna "custos
   * distintos entre triagem leve e pesada" visível na UI.
   */
  @Get('psychologist/analyses')
  @RequireRole('viewer')
  analyses(@Param('projectId') projectId: string) {
    return this.listAnalyses.execute(projectId);
  }

  @Post('hypotheses/:hypothesisId/accept')
  @RequireRole('developer')
  accept(
    @Param('projectId') projectId: string,
    @Param('hypothesisId') hypothesisId: string,
    @CurrentUser() user: User,
  ) {
    return this.acceptHypothesis.execute(projectId, hypothesisId, user.id);
  }

  @Post('hypotheses/:hypothesisId/dismiss')
  @RequireRole('developer')
  dismiss(
    @Param('projectId') projectId: string,
    @Param('hypothesisId') hypothesisId: string,
    @CurrentUser() user: User,
  ) {
    return this.dismissHypothesis.execute(projectId, hypothesisId, user.id);
  }

  /**
   * Reanálise explícita — calibrada em `maintainer` (não `developer`):
   * roda o ToolLoop de novo e gasta orçamento de verdade, diferente de
   * aceitar/descartar, que só movem estado local.
   */
  @Post('sessions/:sessionId/psychologist/reanalyze')
  @RequireRole('maintainer')
  reanalyze(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.reanalyzeSession.execute(projectId, sessionId);
  }
}
