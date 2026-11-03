import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequireRole } from '../iam/require-role.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RecordSourceClickUseCase } from '../../../application/use-cases/rag/record-source-click.use-case';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { SourceClickRequestDto } from './dto/rag.request.dto';
import { SourceClickResponseDto } from './dto/rag.response.dto';

/** `POST .../source-clicks` é `viewer`: quem lê a resposta pode clicar (RN-983). */
@ApiTags('rag')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project does not exist.' })
@Controller('projects/:projectId/source-clicks')
export class SourceClicksController {
  constructor(private readonly clique: RecordSourceClickUseCase) {}

  @Post()
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Records a click on a source of "Consulted this turn" (RN-983)',
    description:
      'A click is NOT a vote: it never feeds `rag_feedback` (RN-480). A failed write is logged ' +
      'with origin `infra` and answers an empty body — the click navigates anyway.',
  })
  @ApiCreatedResponse({ type: SourceClickResponseDto })
  registrar(
    @Param('projectId') projectId: string,
    @Body() body: SourceClickRequestDto,
    @CurrentUser() user: User,
  ) {
    return this.clique.execute({
      projectId,
      sessionId: body.sessionId ?? null,
      eventId: body.eventId,
      tipo: body.tipo,
      ref: body.ref ?? null,
      searchId: body.searchId ?? null,
      chunkId: body.chunkId ?? null,
      userId: user.id,
    });
  }
}
