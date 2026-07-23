import {
  Body,
  Controller,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { ReportSessionTerminationUseCase } from '../../../application/use-cases/sessions/report-session-termination.use-case';
import { AppendSessionEventUseCase } from '../../../application/use-cases/sessions/append-session-event.use-case';
import { ReportSessionTerminationDto } from './dto/report-session-termination.dto';
import { AppendSessionEventInternalDto } from './dto/append-session-event-internal.dto';

/**
 * Chamadas internas do engine (Elixir/OTP) — nunca de um usuário humano.
 * Guardadas por EngineServiceGuard (client credentials do Keycloak,
 * client engine-service), não por RBAC de projeto.
 */
@Controller('internal/sessions')
@UseGuards(EngineServiceGuard)
export class InternalSessionsController {
  private readonly logger = new Logger(InternalSessionsController.name);

  constructor(
    private readonly reportTermination: ReportSessionTerminationUseCase,
    private readonly appendSessionEvent: AppendSessionEventUseCase,
  ) {}

  /**
   * Reportado quando um processo de sessão supervisionado termina
   * (normal defensivo, crash, kill, heartbeat_timeout). Paradas
   * planejadas pela própria api nunca chegam aqui — o engine já sabe
   * delas via outbox, não há o que reportar de volta.
   */
  @Post(':sessionId/termination')
  report(
    @Param('sessionId') sessionId: string,
    @Body() dto: ReportSessionTerminationDto,
  ) {
    this.logger.warn(
      `Sessão ${sessionId} terminou no engine (${dto.to}): ${dto.reason ?? '(sem motivo informado)'}`,
    );
    return this.reportTermination.execute(dto.projectId, sessionId, dto.to);
  }

  /**
   * Usado pelo PsychologistWorker (placeholder, fase 3+ traz a análise
   * real) pra gravar psychologist.hypothesis no event log — reaproveita
   * o mesmo use-case/contrato de seq atômico da rota humana.
   */
  @Post(':sessionId/events')
  appendEvent(
    @Param('sessionId') sessionId: string,
    @Body() dto: AppendSessionEventInternalDto,
  ) {
    return this.appendSessionEvent.execute(dto.projectId, sessionId, {
      type: dto.type,
      actor: { kind: dto.actorKind, id: dto.actorId },
      payload: dto.payload,
    });
  }
}
