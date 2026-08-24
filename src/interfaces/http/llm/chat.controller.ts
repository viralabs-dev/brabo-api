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
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project or session not found.' })
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
    summary: "Talks to the session's model, with the response streamed",
    description:
      'Server-Sent Events. `delta` frames carry the incremental text and ' +
      '`done` closes with the token and cost accounting. A `metering_failed` ' +
      'frame means the RESPONSE went out but the cost was not accounted for ' +
      '— the failure shows up instead of disappearing. If the budget is ' +
      'exceeded with `policy=block`, the stream carries `error` and no `delta`.',
  })
  @ApiExtraModels(ChatSseEventResponseDto)
  @ApiResponse({
    status: 200,
    description: 'Stream of frames until `done` or `error`.',
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
