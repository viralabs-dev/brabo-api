import {
  Body,
  Controller,
  MessageEvent,
  Param,
  RequestMethod,
  Sse,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Observable, from, map } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SendChatMessageUseCase } from '../../../application/use-cases/llm/send-chat-message.use-case';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ChatSseEventResponseDto } from './dto/llm.response.dto';

@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto ou sessão inexistente.' })
@Controller('projects/:projectId/sessions/:sessionId/chat')
export class ChatController {
  constructor(private readonly sendChatMessage: SendChatMessageUseCase) {}

  /**
   * A resposta é um STREAM, e por isso o schema é declarado à mão: o
   * `text/event-stream` não tem corpo único, tem uma sequência de quadros. O
   * que está documentado é o formato de CADA QUADRO — dizer apenas "é um
   * stream" deixaria de fora exatamente o que o cliente precisa saber.
   */
  @Sse('', { method: RequestMethod.POST })
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Conversa com o modelo da sessão, com a resposta em stream',
    description:
      'Server-Sent Events. Os quadros `delta` trazem o texto incremental e o `done` ' +
      'fecha com a contabilidade de tokens e custo. Um quadro `metering_failed` ' +
      'significa que a RESPOSTA saiu mas o custo não foi contabilizado — a falha ' +
      'aparece em vez de sumir. Se o orçamento estiver estourado com `policy=block`, ' +
      'o stream traz `error` e nenhum `delta`.',
  })
  @ApiExtraModels(ChatSseEventResponseDto)
  @ApiResponse({
    status: 200,
    description: 'Stream de quadros até `done` ou `error`.',
    content: {
      'text/event-stream': {
        schema: { $ref: getSchemaPath(ChatSseEventResponseDto) },
      },
    },
  })
  chat(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: SendChatMessageDto,
  ): Observable<MessageEvent> {
    return from(
      this.sendChatMessage.execute({
        projectId,
        sessionId,
        actor: { kind: 'user', id: user.id },
        text: dto.text,
      }),
    ).pipe(map((event) => ({ data: event })));
  }
}
