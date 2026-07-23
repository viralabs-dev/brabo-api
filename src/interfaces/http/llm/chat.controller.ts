import {
  Body,
  Controller,
  MessageEvent,
  Param,
  RequestMethod,
  Sse,
} from '@nestjs/common';
import { Observable, from, map } from 'rxjs';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { SendChatMessageUseCase } from '../../../application/use-cases/llm/send-chat-message.use-case';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@Controller('projects/:projectId/sessions/:sessionId/chat')
export class ChatController {
  constructor(private readonly sendChatMessage: SendChatMessageUseCase) {}

  @Sse('', { method: RequestMethod.POST })
  @RequireRole('developer')
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
