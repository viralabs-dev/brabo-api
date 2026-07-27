import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BraboMetrics } from '../../../infrastructure/observability/brabo-metrics';
import { Public } from '../auth/public.decorator';

/**
 * Endpoint de scrape do Prometheus (Fase 5, item 4).
 *
 * `@Public()` é OBRIGATÓRIO: o `JwtAuthGuard` é global nesta api, e sem esta
 * anotação o scrape recebe 401 — o Prometheus não carrega token do Keycloak, e
 * o sintoma seria um target `down` com todo o resto verde.
 *
 * O alcance é restringido por rede, não por token: o Ingress de produção
 * bloqueia `/metrics` na borda (ver overlays/prod/ingress.yaml, mesmo
 * tratamento que o `/metrics` do engine já recebe), e dentro do cluster só o
 * namespace de monitoramento tem motivo para chamar.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: BraboMetrics) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType);
    res.send(await this.metrics.scrape());
  }
}
