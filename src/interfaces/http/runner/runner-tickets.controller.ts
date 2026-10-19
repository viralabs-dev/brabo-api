import { Controller, Post, Param, Req, UseGuards } from '@nestjs/common';
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
import { RequirePatAuth } from '../auth/pat-route.decorator';
import { PatAuthGuard } from '../auth/pat-auth.guard';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { BEARER } from '../../../infrastructure/openapi/documento';
import { RequestRunnerTicketUseCase } from '../../../application/use-cases/runner/request-runner-ticket.use-case';
import { RunnerTicketResponseDto } from './dto/runner-ticket.response.dto';

/**
 * Tickets do socket `/runner` (RN-108 replicado por projeto — ver o
 * moduledoc de `EngineWeb.RunnerSocket` no engine). Duas rotas, dois papéis
 * do MESMO tópico `terminal:<projectId>`:
 *
 * - `runner-ticket`: o CLI na máquina do usuário. Só existe em projeto no
 *   modo `runner` (RN-421, ADR 0104) — ver `RequestRunnerTicketUseCase` pro
 *   porquê. Autenticado por Personal Access Token OU chave de dispositivo
 *   (Ed25519, gerada no navegador), NUNCA por JWT de sessão
 *   (`PatAuthGuard`/`@RequirePatAuth()`, ADR 0105) — não há chamador de
 *   browser autenticado por SESSÃO pra esta rota. Papel mínimo `developer`,
 *   aplicado pelo PRÓPRIO `PatAuthGuard` (RN-439): `RolesGuard` é guard
 *   GLOBAL e roda ANTES de `PatAuthGuard`, que é LOCAL — nunca depois, não
 *   importa a ordem dos decorators abaixo — então `RolesGuard` se abstém
 *   aqui (rota `@RequirePatAuth()`) e é `PatAuthGuard` quem revalida o papel
 *   do dono da credencial pela via normal, depois de autenticar.
 * - `terminal-ticket`: a aba Terminal da web, que só VÊ e interage — papel
 *   mínimo `viewer`, JWT de sessão normal, mesma régua das outras leituras
 *   da aba Code (`containers.controller.ts`).
 */
@ApiTags('projects')
@ApiBearerAuth(BEARER)
@ApiForbiddenResponse({ description: 'Insufficient role on the project.' })
@ApiNotFoundResponse({ description: 'Project not found.' })
@Controller('projects/:projectId')
export class RunnerTicketsController {
  constructor(private readonly requestTicket: RequestRunnerTicketUseCase) {}

  @Post('runner-ticket')
  @RequirePatAuth()
  @UseGuards(PatAuthGuard)
  @RequireRole('developer')
  @ApiOperation({
    summary: 'Issues a single-use ticket for the local runner to connect',
    description:
      'Authenticates `connect/3` of the Phoenix socket `/runner` (topic ' +
      '`terminal:<projectId>`, role "runner") — it is NOT the reused JWT, ' +
      'and this route itself only accepts a Personal Access Token instead of ' +
      'the session JWT (ADR 0105). 30s TTL and single use. Refuses with 400 ' +
      'if the project is not in "runner" mode (RN-421): the runner has ' +
      'nothing to serve in a project whose code lives in the managed container.',
  })
  @ApiCreatedResponse({ type: RunnerTicketResponseDto })
  @ApiBadRequestResponse({
    description: 'Project is not in "runner" mode.',
  })
  runnerTicket(
    @Param('projectId') projectId: string,
    @CurrentUser() user: User,
    @Req() request: AuthenticatedRequest,
  ) {
    // A credencial que o `PatAuthGuard` autenticou vai para a linha do
    // ticket (ADR 0201, RN-685) — é ela que a revogação compara depois.
    return this.requestTicket
      .execute(projectId, user.id, 'runner', request.credencialDeDispositivo)
      .then(paraResposta);
  }

  @Post('terminal-ticket')
  @RequireRole('viewer')
  @ApiOperation({
    summary: 'Issues a single-use ticket for the web Terminal tab',
    description:
      'Same `/runner` socket, same topic, role "terminal" — whoever SEES the ' +
      'terminal (the command itself only really runs if a runner is ' +
      'connected). Valid for any project mode.',
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
