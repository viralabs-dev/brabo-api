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
@ApiTags('infraestrutura')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: BraboMetrics) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Expõe as métricas no formato de exposição do Prometheus',
    description:
      'Não é JSON: é `text/plain` no formato de exposição. Pública por necessidade ' +
      '(o scraper não carrega token) e restringida por REDE — o Ingress de produção ' +
      'bloqueia este caminho na borda e a NetworkPolicy só libera o namespace de ' +
      'monitoramento.',
  })
  @ApiResponse({
    status: 200,
    description: 'Métricas no formato de exposição.',
    content: {
      'text/plain': {
        schema: { type: 'string' },
        example:
          '# HELP oban_queue_depth Profundidade da fila do Oban\n' +
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
