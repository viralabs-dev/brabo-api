import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { HealthStatus } from '@brabo/shared';
import { DRIZZLE } from '../../../infrastructure/persistence/drizzle/drizzle-client';
import type { DrizzleDb } from '../../../infrastructure/persistence/drizzle/drizzle-client';
import { Public } from '../auth/public.decorator';
import { HealthStatusResponseDto } from './dto/health.response.dto';

@ApiTags('infrastructure')
@Controller()
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Liveness: responde sem tocar o banco, de propósito.
   *
   * `/health` consulta o Postgres, o que é a resposta certa para readiness e a
   * errada para liveness: um banco lento reiniciaria TODAS as réplicas ao
   * mesmo tempo, derrubando justamente quem sobreviveria à indisponibilidade e
   * transformando degradação em queda total. Liveness só responde "este
   * processo ainda atende requisição"; quem tira o pod do balanceamento é o
   * readiness.
   */
  @Public()
  @Get('live')
  @ApiOperation({
    summary: 'Liveness — the process still serves requests',
    description:
      'Does NOT touch the database, on purpose. If it did, a slow Postgres would ' +
      'restart ALL replicas at once and turn degradation into a total outage. ' +
      'The pod is pulled from the load balancer by `/health`.',
  })
  @ApiOkResponse({ type: HealthStatusResponseDto })
  live(): HealthStatus {
    return {
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({
    summary: 'Readiness — the process can actually serve traffic',
    description:
      'Runs a `select 1`. Reveals only whether the database responds; no topology ' +
      'or version. Public because the caller is kubelet, which carries no token.',
  })
  @ApiOkResponse({ type: HealthStatusResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'The database did not respond. The body carries the message in `details`.',
    type: HealthStatusResponseDto,
  })
  async check(): Promise<HealthStatus> {
    try {
      await this.db.execute(sql`select 1`);
      return {
        service: 'api',
        status: 'ok',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        service: 'api',
        status: 'error',
        timestamp: new Date().toISOString(),
        details: { message: (error as Error).message },
      } satisfies HealthStatus);
    }
  }
}
