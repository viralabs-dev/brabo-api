import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { PerguntasEmAbertoUseCase } from '../../../application/use-cases/backlog/perguntas-em-aberto.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import {
  AnswerOpenQuestionDto,
  ListOpenQuestionsQueryDto,
  OpenQuestionResponseDto,
  OpenQuestionsListResponseDto,
} from './dto/open-questions.dto';

/**
 * Perguntas em aberto de agente (AT-521, RN-858, ADR 0214): a fila do
 * projeto e a resposta, que vira `decision_record`.
 */
@ApiTags('backlog')
@ApiBearerAuth(BEARER)
@Controller('projects/:projectId/open-questions')
export class OpenQuestionsController {
  constructor(private readonly perguntas: PerguntasEmAbertoUseCase) {}

  @Get()
  @RequireRole('viewer')
  @ApiOperation({
    summary: "Lists the agents' open questions of the project (RN-858)",
    description:
      'Status comes from the event log: open is an `artifact.open_question` ' +
      'without `open_question.answered`. Newest first, capped at 50 with `total`.',
  })
  @ApiOkResponse({ type: OpenQuestionsListResponseDto })
  list(
    @Param('projectId') projectId: string,
    @Query() query: ListOpenQuestionsQueryDto,
  ) {
    return this.perguntas.listar(projectId, query.status ?? 'open');
  }

  @Post(':questionId/answer')
  @HttpCode(200)
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Answers an open question (RN-858)',
    description:
      'Only the author of the session where the question was born answers. ' +
      'Writes a `decision_record` (actor: the user, with `questionId`) and ' +
      '`open_question.answered`, and asks the engine to resume the parked QA ' +
      'gate of each affected task (RN-860), best effort.',
  })
  @ApiOkResponse({ type: OpenQuestionResponseDto })
  @ApiBadRequestResponse({
    description: 'No answer, or a suggestion accepted where there is none.',
  })
  @ApiForbiddenResponse({
    description:
      'Not the session author — body with `reason: "so_o_autor_da_sessao"`.',
  })
  @ApiNotFoundResponse({ description: 'Question is not in this project.' })
  @ApiConflictResponse({
    description: 'Already answered — `reason: "pergunta_ja_respondida"`.',
  })
  answer(
    @Param('projectId') projectId: string,
    @Param('questionId') questionId: string,
    @Body() dto: AnswerOpenQuestionDto,
    @CurrentUser() user: User,
  ) {
    return this.perguntas.responder(projectId, questionId, user.id, dto);
  }
}
