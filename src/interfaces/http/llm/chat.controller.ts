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
  ApiUnprocessableEntityResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Observable, from, map } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SendChatMessageUseCase } from '../../../application/use-cases/llm/send-chat-message.use-case';
import { GarantirDestinatarioDoChatUseCase } from '../../../application/use-cases/llm/garantir-destinatario-do-chat.use-case';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { ChatSseEventResponseDto } from './dto/llm.response.dto';

@ApiTags('llm')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project or session not found.' })
@Controller('projects/:projectId/sessions/:sessionId/chat')
export class ChatController {
  constructor(
    private readonly sendChatMessage: SendChatMessageUseCase,
    private readonly garantirDestinatario: GarantirDestinatarioDoChatUseCase,
  ) {}

  /**
   * A resposta é um STREAM, e por isso o schema é declarado à mão: o
   * `text/event-stream` não tem corpo único, tem uma sequência de quadros. O
   * que está documentado é o formato de CADA QUADRO — dizer apenas "é um
   * stream" deixaria de fora exatamente o que o cliente precisa saber.
   *
   * RN-682 (AT-254): a guarda roda ANTES do stream abrir — o handler devolve
   * `Promise<Observable>`, e a rejeição antes de o cabeçalho SSE sair vira a
   * resposta HTTP normal (422 nomeado), não um quadro `error` dentro de um 200.
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
      'exceeded with `policy=block`, the stream carries `error` and no `delta`. ' +
      'This route carries NO agent: it sends the text alone to the bound model, ' +
      'with no history and no system prompt. In a `consultiva` session where no ' +
      'agent was ever activated it is refused before any effect (RN-682) — talk ' +
      'to an agent through `.../agents/:agent/message` instead.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      '`destinatario_ausente`: a `consultiva` session with no agent — the ' +
      'message has no recipient. Nothing was recorded and no model was called ' +
      '(RN-682).',
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
  async chat(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: SendChatMessageDto,
  ): Promise<Observable<MessageEvent>> {
    await this.garantirDestinatario.execute(projectId, sessionId);
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
