import {
  Body,
  Controller,
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
import { PerguntasEmAbertoUseCase } from '../../../application/use-cases/backlog/perguntas-em-aberto.use-case';
import { SERVICE_TOKEN } from '../../../infrastructure/openapi/documento';
import {
  AgentAnswerOpenQuestionDto,
  AgentAnswerOpenQuestionResponseDto,
} from './dto/open-questions-internal.dto';

/**
 * O agente fecha a pergunta em aberto que o usuário respondeu pelo chat
 * (AT-741, RN-1002, ADR 0214). O mesmo núcleo do clique humano.
 */
@ApiTags('internal')
@ApiSecurity(SERVICE_TOKEN)
@ApiForbiddenResponse({
  description: 'Service token missing or different from the shared one.',
})
@Controller('internal')
@ServiceRoute()
@UseGuards(EngineServiceGuard)
export class InternalOpenQuestionsController {
  constructor(private readonly perguntas: PerguntasEmAbertoUseCase) {}

  @Post('projects/:projectId/open-questions/:questionId/answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Closes an open question on behalf of an agent (RN-1002)',
    description:
      'Writes the same `decision_record` + `open_question.answered` pair as ' +
      'the human answer (actor: the author of the chat session, `viaAgente` ' +
      'names the agent) and resumes the parked QA gate (RN-860). Without ' +
      '`resposta`, the question suggestion is the answer. Idempotent: an ' +
      'already closed question returns `already_answered`, never 409.',
  })
  @ApiOkResponse({ type: AgentAnswerOpenQuestionResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, or no answer and no suggestion.',
  })
  @ApiNotFoundResponse({
    description: 'Question or session not in this project.',
  })
  answer(
    @Param('projectId') projectId: string,
    @Param('questionId') questionId: string,
    @Body() dto: AgentAnswerOpenQuestionDto,
  ) {
    return this.perguntas.responderPeloAgente(projectId, questionId, dto);
  }
}
