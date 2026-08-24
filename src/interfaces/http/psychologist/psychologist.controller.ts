import { Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { ListHypothesesUseCase } from '../../../application/use-cases/execution/list-hypotheses.use-case';
import { AcceptHypothesisUseCase } from '../../../application/use-cases/execution/accept-hypothesis.use-case';
import { DismissHypothesisUseCase } from '../../../application/use-cases/execution/dismiss-hypothesis.use-case';
import { ReanalyzeSessionUseCase } from '../../../application/use-cases/execution/reanalyze-session.use-case';
import { GetPsychologistStatusUseCase } from '../../../application/use-cases/execution/get-psychologist-status.use-case';
import { ListPsychologistAnalysesUseCase } from '../../../application/use-cases/execution/list-psychologist-analyses.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import {
  HypothesisResponseDto,
  PsychologistAnalysisResponseDto,
  PsychologistStatusResponseDto,
} from './dto/psychologist.response.dto';

/**
 * Ações humanas sobre as hipóteses do Psicólogo (Fase 4b): listar (seção
 * Insights), aceitar/descartar (ciclo de vida proposed -> accepted |
 * dismissed) e disparar reanálise explícita de uma sessão. Aceitar/
 * descartar NÃO são proposed_actions — o Psicólogo é só leitura, nunca
 * propõe ação com efeito externo.
 */
@ApiTags('psychologist')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({
  description: 'Project, session, or hypothesis does not exist.',
})
@Controller('projects/:projectId')
export class PsychologistController {
  constructor(
    private readonly listHypotheses: ListHypothesesUseCase,
    private readonly acceptHypothesis: AcceptHypothesisUseCase,
    private readonly dismissHypothesis: DismissHypothesisUseCase,
    private readonly reanalyzeSession: ReanalyzeSessionUseCase,
    private readonly getStatus: GetPsychologistStatusUseCase,
    private readonly listAnalyses: ListPsychologistAnalysesUseCase,
  ) {}

  @Get('hypotheses')
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lists the Psychologist's hypotheses about the agents",
    description:
      'Each hypothesis cites the events that support it (`evidenceEventIds`) — ' +
      'this is what makes it auditable instead of taken on faith.',
  })
  @ApiOkResponse({ type: [HypothesisResponseDto] })
  hypotheses(@Param('projectId') projectId: string) {
    return this.listHypotheses.execute(projectId);
  }

  /**
   * Análises current do projeto com tier e CUSTO — é o que torna "custos
   * distintos entre triagem leve e pesada" visível na UI.
   */
  @Get('psychologist/analyses')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Lists the analysis rounds with tier and real cost',
    description:
      "`costMicros` is summed from the round's `token_usage`. This is what makes " +
      'the cost difference between light and heavy triage VISIBLE, instead of ' +
      'just asserted — the two tiers use genuinely different models.',
  })
  @ApiOkResponse({ type: [PsychologistAnalysisResponseDto] })
  analyses(@Param('projectId') projectId: string) {
    return this.listAnalyses.execute(projectId);
  }

  /**
   * Leitura da flag global `PSYCHOLOGIST_ENABLED` (RN-454) — sem efeito
   * colateral, ao contrário de `reanalyze` abaixo. Existe para a aba
   * Insights conseguir dizer que a pausa é DECISÃO antes do usuário clicar
   * em "Reanalisar", que só aparece quando já há uma rodada de análise —
   * uma sessão sem hipótese nenhuma nunca chegava perto do 503 que
   * denunciava a pausa.
   */
  @Get('psychologist/status')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Reports whether the Psychologist can run a NEW analysis today',
    description:
      'Read-only — has no side effect. `enabled: false` means the pause is a ' +
      "PRODUCT decision (not a bug): existing analyses and hypotheses aren't " +
      'touched by it.',
  })
  @ApiOkResponse({ type: PsychologistStatusResponseDto })
  status() {
    return this.getStatus.execute();
  }

  @Post('hypotheses/:hypothesisId/accept')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Accepts a hypothesis',
    description:
      'Moves `proposed` → `accepted`. NOT a `proposed_action`: the Psychologist ' +
      'is read-only and nothing here has an external effect.',
  })
  @ApiCreatedResponse({ type: HypothesisResponseDto })
  @ApiConflictResponse({ description: 'The hypothesis was already decided.' })
  accept(
    @Param('projectId') projectId: string,
    @Param('hypothesisId') hypothesisId: string,
    @CurrentUser() user: User,
  ) {
    return this.acceptHypothesis.execute(projectId, hypothesisId, user.id);
  }

  @Post('hypotheses/:hypothesisId/dismiss')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Dismisses a hypothesis',
    description: 'Moves `proposed` → `dismissed`. Same reasoning as accepting.',
  })
  @ApiCreatedResponse({ type: HypothesisResponseDto })
  @ApiConflictResponse({ description: 'The hypothesis was already decided.' })
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
  @ApiOperation({
    summary: 'Triggers a reanalysis of the session',
    description:
      'Requires `maintainer`, not `developer`, because it runs the ToolLoop ' +
      'again and SPENDS real budget — unlike accepting or dismissing, which only ' +
      'move local state. The previous analysis is marked superseded.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiServiceUnavailableResponse({
    description:
      "The Psychologist is disabled globally by the user's decision (not a " +
      'bug) — body with `reason: "psychologist_disabled"`.',
  })
  reanalyze(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.reanalyzeSession.execute(projectId, sessionId);
  }
}
