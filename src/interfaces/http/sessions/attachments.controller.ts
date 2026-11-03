import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { AnexosDoChatUseCase } from '../../../application/use-cases/sessions/anexos-do-chat.use-case';
import { AnexoResponseDto, UploadAnexoDto } from './dto/attachments.dto';

/** Anexos do chat (AT-715, ADR 0246, RN-986/RN-988). */
@ApiTags('sessions')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role in the project.' })
@ApiNotFoundResponse({
  description: 'Project, session or attachment not found.',
})
@Controller('projects/:projectId/sessions/:sessionId/attachments')
export class AttachmentsController {
  constructor(private readonly anexos: AnexosDoChatUseCase) {}

  @Post()
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Uploads a chat attachment (JSON with base64)',
    description:
      'Text/code (UTF-8) up to 512 KB or png/jpeg/webp/gif up to 5 MB; the type is checked ' +
      'against the bytes. Returns the reference to pass as `anexos` in the agent message. ' +
      'JSON+base64 instead of multipart: it fits the 10 MB body limit and adds no parser (RN-986).',
  })
  @ApiCreatedResponse({ type: AnexoResponseDto })
  @ApiPayloadTooLargeResponse({ description: 'Over the size limit.' })
  @ApiUnsupportedMediaTypeResponse({ description: 'Type not accepted.' })
  @ApiConflictResponse({
    description: 'The session is closed (`sessao_encerrada`, RN-581).',
  })
  enviar(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: User,
    @Body() dto: UploadAnexoDto,
  ) {
    return this.anexos.enviar(
      projectId,
      sessionId,
      user.id,
      dto.nome,
      dto.base64,
    );
  }

  @Get(':attachmentId')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Downloads the attachment bytes',
    description:
      'Every `viewer` of the project reads it (RN-988). Served with the stored `Content-Type`, ' +
      '`nosniff`, and `attachment` disposition for anything that is not an image.',
  })
  @ApiOkResponse({
    description: 'The raw bytes.',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async ler(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const a = await this.anexos.ler(projectId, sessionId, attachmentId);
    res.set({
      'Content-Type': a.mime,
      'X-Content-Type-Options': 'nosniff',
      ...(a.mime.startsWith('image/')
        ? {}
        : {
            'Content-Disposition': `attachment; filename="${encodeURIComponent(a.nome)}"`,
          }),
    });
    return new StreamableFile(a.bytes);
  }
}
