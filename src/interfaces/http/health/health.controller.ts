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

@ApiTags('infraestrutura')
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
    summary: 'Liveness — o processo ainda atende requisição',
    description:
      'NÃO toca o banco, de propósito. Se tocasse, um Postgres lento reiniciaria ' +
      'TODAS as réplicas ao mesmo tempo e transformaria degradação em queda total. ' +
      'Quem tira o pod do balanceamento é o `/health`.',
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
    summary: 'Readiness — o processo consegue atender de verdade',
    description:
      'Faz um `select 1`. Revela apenas se o banco responde; nada de topologia ou ' +
      'versão. Pública porque quem chama é o kubelet, que não carrega token.',
  })
  @ApiOkResponse({ type: HealthStatusResponseDto })
  @ApiServiceUnavailableResponse({
    description: 'O banco não respondeu. O corpo traz a mensagem em `details`.',
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
