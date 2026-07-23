import {
  Body,
  Controller,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EngineServiceGuard } from '../auth/engine-service.guard';
import { TransitionSessionUseCase } from '../../../application/use-cases/sessions/transition-session.use-case';
import { ReportSessionTerminationDto } from './dto/report-session-termination.dto';

/**
 * Reportado pelo engine (Elixir/OTP) quando um processo de sessão
 * supervisionado morre por causa inesperada (crash/kill). Paradas
 * planejadas nunca chegam aqui — o engine já sabe delas via outbox
 * (session.closed/session.closed_abnormally), a api já registrou o
 * estado, não há o que reportar de volta.
 */
@Controller('internal/sessions')
@UseGuards(EngineServiceGuard)
export class SessionTerminationController {
  private readonly logger = new Logger(SessionTerminationController.name);

  constructor(private readonly transitionSession: TransitionSessionUseCase) {}

  @Post(':sessionId/termination')
  report(
    @Param('sessionId') sessionId: string,
    @Body() dto: ReportSessionTerminationDto,
  ) {
    this.logger.warn(
      `Sessão ${sessionId} terminou inesperadamente no engine: ${dto.reason ?? '(sem motivo informado)'}`,
    );
    return this.transitionSession.execute(
      dto.projectId,
      sessionId,
      'closed_abnormally',
    );
  }
}
