import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { BraboMetrics } from '../../../infrastructure/observability/brabo-metrics';
import { Public } from '../auth/public.decorator';

/**
 * Endpoint de scrape do Prometheus (Fase 5, item 4).
 *
 * `@Public()` é OBRIGATÓRIO: o `JwtAuthGuard` é global nesta api, e sem esta
 * anotação o scrape recebe 401 — o Prometheus não carrega token nenhum, e o
 * sintoma seria um target `down` com todo o resto verde.
 *
 * O alcance é restringido por rede, não por token: o Ingress de produção
 * bloqueia `/metrics` na borda (ver overlays/prod/ingress.yaml, mesmo
 * tratamento que o `/metrics` do engine já recebe), e dentro do cluster só o
 * namespace de monitoramento tem motivo para chamar.
 */
@ApiTags('infrastructure')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: BraboMetrics) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Exposes metrics in Prometheus exposition format',
    description:
      "Not JSON: it's `text/plain` in exposition format. Public out of necessity " +
      '(the scraper carries no token) and restricted by NETWORK — the production ' +
      'Ingress blocks this path at the edge and the NetworkPolicy only allows the ' +
      'monitoring namespace.',
  })
  @ApiResponse({
    status: 200,
    description: 'Metrics in exposition format.',
    content: {
      'text/plain': {
        schema: { type: 'string' },
        example:
          '# HELP oban_queue_depth Oban queue depth\n' +
          '# TYPE oban_queue_depth gauge\n' +
          'oban_queue_depth{queue="default",state="available"} 0\n',
      },
    },
  })
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.scrape());
  }
}
