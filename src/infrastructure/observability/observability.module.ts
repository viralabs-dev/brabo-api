import { Global, Module } from '@nestjs/common';
import { BraboMetrics } from './brabo-metrics';
import { DomainGaugesCollector } from './domain-gauges.collector';

/**
 * Métricas Prometheus da api (Fase 5, item 4).
 *
 * `@Global()` pelo mesmo motivo do DrizzleModule: as métricas são incrementadas
 * de pontos espalhados pelo domínio (metering de LLM, decisão de ação), e
 * importar um módulo em cada um deles só para injetar um contador seria
 * cerimônia sem função.
 */
@Global()
@Module({
  providers: [BraboMetrics, DomainGaugesCollector],
  exports: [BraboMetrics],
})
export class ObservabilityModule {}
