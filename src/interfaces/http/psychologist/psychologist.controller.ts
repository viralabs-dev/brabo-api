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
import { ListPsychologistAnalysesUseCase } from '../../../application/use-cases/execution/list-psychologist-analyses.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { OkResponseDto } from '../shared/dto/comuns.response.dto';
import {
  HypothesisResponseDto,
  PsychologistAnalysisResponseDto,
} from './dto/psychologist.response.dto';

/**
 * Ações humanas sobre as hipóteses do Psicólogo (Fase 4b): listar (seção
 * Insights), aceitar/descartar (ciclo de vida proposed -> accepted |
 * dismissed) e disparar reanálise explícita de uma sessão. Aceitar/
 * descartar NÃO são proposed_actions — o Psicólogo é só leitura, nunca
 * propõe ação com efeito externo.
 */
@ApiTags('psicólogo')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({
  description: 'Projeto, sessão ou hipótese inexistente.',
})
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
  @ApiOperation({
    summary: 'Lista as hipóteses do Psicólogo sobre os agentes',
    description:
      'Cada hipótese cita os eventos que a sustentam (`evidenceEventIds`) — é o que ' +
      'a torna auditável em vez de acreditada.',
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
    summary: 'Lista as rodadas de análise com tier e custo real',
    description:
      'O `costMicros` sai somado do `token_usage` da rodada. É o que torna a ' +
      'diferença de custo entre triagem leve e pesada VISÍVEL, em vez de apenas ' +
      'afirmada — os dois tiers usam modelos genuinamente diferentes.',
  })
  @ApiOkResponse({ type: [PsychologistAnalysisResponseDto] })
  analyses(@Param('projectId') projectId: string) {
    return this.listAnalyses.execute(projectId);
  }

  @Post('hypotheses/:hypothesisId/accept')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Aceita uma hipótese',
    description:
      'Move `proposed` → `accepted`. NÃO é uma `proposed_action`: o Psicólogo é só ' +
      'leitura e nada aqui tem efeito externo.',
  })
  @ApiCreatedResponse({ type: HypothesisResponseDto })
  @ApiConflictResponse({ description: 'A hipótese já foi decidida.' })
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
    summary: 'Descarta uma hipótese',
    description: 'Move `proposed` → `dismissed`. Mesmo raciocínio do aceite.',
  })
  @ApiCreatedResponse({ type: HypothesisResponseDto })
  @ApiConflictResponse({ description: 'A hipótese já foi decidida.' })
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
    summary: 'Dispara uma reanálise da sessão',
    description:
      'Exige `maintainer`, e não `developer`, porque roda o ToolLoop de novo e GASTA ' +
      'orçamento de verdade — diferente de aceitar ou descartar, que só movem estado ' +
      'local. A análise anterior é marcada como superseded.',
  })
  @ApiCreatedResponse({ type: OkResponseDto })
  @ApiServiceUnavailableResponse({
    description:
      'O Psicólogo está desativado globalmente por decisão do usuário (não ' +
      'é bug) — corpo com `reason: "psychologist_disabled"`.',
  })
  reanalyze(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.reanalyzeSession.execute(projectId, sessionId);
  }
}
