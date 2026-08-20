import { Controller, Post, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { User } from '../../../domain/iam/user.entity';
import { RequireRole } from '../iam/require-role.decorator';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RequestRunnerTicketUseCase } from '../../../application/use-cases/runner/request-runner-ticket.use-case';
import { RunnerTicketResponseDto } from './dto/runner-ticket.response.dto';

/**
 * Tickets do socket `/runner` (RN-108 replicado por projeto — ver o
 * moduledoc de `EngineWeb.RunnerSocket` no engine). Duas rotas, dois papéis
 * do MESMO tópico `terminal:<projectId>`:
 *
 * - `runner-ticket`: o CLI na máquina do usuário. Só existe em projeto modo
 *   `local` (ADR 0072) — ver `RequestRunnerTicketUseCase` pro porquê. Papel
 *   mínimo `developer`, o mesmo de ações de terminal
 *   (`MIN_ROLE_FOR_ACTION_TYPE.terminal`).
 * - `terminal-ticket`: a aba Terminal da web, que só VÊ e interage — papel
 *   mínimo `viewer`, mesma régua das outras leituras da aba Code
 *   (`containers.controller.ts`).
 */
@ApiTags('projetos')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Papel insuficiente no projeto.' })
@ApiNotFoundResponse({ description: 'Projeto não encontrado.' })
@Controller('projects/:projectId')
export class RunnerTicketsController {
  constructor(private readonly requestTicket: RequestRunnerTicketUseCase) {}

  @Post('runner-ticket')
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Emite um ticket de uso único para o runner local conectar',
    description:
      'Autentica `connect/3` do socket Phoenix `/runner` (tópico ' +
      '`terminal:<projectId>`, papel "runner") — NÃO é o JWT reaproveitado. ' +
      'TTL de 30s e uso único. Recusa com 400 se o projeto não estiver no ' +
      'modo "local" (ADR 0072): o runner não tem o que servir num projeto ' +
      'cujo código mora no container gerenciado.',
  })
  @ApiCreatedResponse({ type: RunnerTicketResponseDto })
  @ApiBadRequestResponse({
    description: 'Projeto não está no modo "local".',
  })
  runnerTicket(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.requestTicket
      .execute(projectId, user.id, 'runner')
      .then(paraResposta);
  }

  @Post('terminal-ticket')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Emite um ticket de uso único para a aba Terminal da web',
    description:
      'Mesmo socket `/runner`, mesmo tópico, papel "terminal" — quem VÊ o ' +
      'terminal (o comando em si só roda de verdade se houver um runner ' +
      'conectado). Vale para qualquer modo de projeto.',
  })
  @ApiCreatedResponse({ type: RunnerTicketResponseDto })
  terminalTicket(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
  ) {
    return this.requestTicket
      .execute(projectId, user.id, 'terminal')
      .then(paraResposta);
  }
}

function paraResposta(emitido: {
  ticket: string;
  expiresAt: Date;
  engineWsUrl: string;
}): RunnerTicketResponseDto {
  return {
    ticket: emitido.ticket,
    expiresAt: emitido.expiresAt.toISOString(),
    engineWsUrl: emitido.engineWsUrl,
  };
}
