import { describe, it, expect, beforeEach } from 'vitest';
import { BraboMetrics } from '../../../src/infrastructure/observability/brabo-metrics';

/**
 * As métricas do item 4 da Fase 5.
 *
 * O que estes testes protegem não é "o contador soma" — é o CONTRATO DE NOMES.
 * `brabo_llm_cost_micros_total`, `brabo_sessions_active` e os rótulos
 * `project`/`provider` são referenciados por string em três lugares que não se
 * enxergam: os dois dashboards do Grafana, as regras de alerta e as consultas
 * do runbook. Renomear qualquer um compila, passa em todo o resto da suite, e o
 * único sintoma é um painel vazio que ninguém percebe até precisar dele.
 */
describe('BraboMetrics', () => {
  let metrics: BraboMetrics;

  beforeEach(() => {
    // Registry próprio por teste: o default do prom-client é global e
    // contadores vazariam entre casos.
    metrics = new BraboMetrics();
  });

  it('expõe custo e tokens com os nomes que os dashboards consultam', async () => {
    metrics.recordLlmUsage({
      projectId: 'proj-1',
      provider: 'anthropic',
      inputTokens: 100,
      outputTokens: 40,
      costMicros: 25_000,
      latencyMs: 1_500,
    });

    const scraped = await metrics.scrape();

    expect(scraped).toContain('brabo_llm_cost_micros_total');
    expect(scraped).toContain('brabo_llm_tokens_total');
    expect(scraped).toMatch(
      /brabo_llm_cost_micros_total\{[^}]*project="proj-1"/,
    );
    expect(scraped).toMatch(
      /brabo_llm_cost_micros_total\{[^}]*provider="anthropic"/,
    );
  });

  it('separa tokens de input e de output', async () => {
    metrics.recordLlmUsage({
      projectId: 'proj-1',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 40,
      costMicros: 1,
      latencyMs: 10,
    });

    const scraped = await metrics.scrape();

    expect(scraped).toMatch(
      /brabo_llm_tokens_total\{[^}]*kind="input"[^}]*\} 100/,
    );
    expect(scraped).toMatch(
      /brabo_llm_tokens_total\{[^}]*kind="output"[^}]*\} 40/,
    );
  });

  it('registra latência em SEGUNDOS, não em milissegundos', async () => {
    metrics.recordLlmUsage({
      projectId: 'p',
      provider: 'ollama',
      inputTokens: 1,
      outputTokens: 1,
      costMicros: 0,
      latencyMs: 2_000,
    });

    const scraped = await metrics.scrape();

    // A convenção do Prometheus é segundo, e o `histogram_quantile` dos
    // dashboards assume isso. Gravar milissegundo aqui daria p95 de "1500"
    // rotulado como segundos — errado por três ordens de grandeza, e
    // plausível o suficiente para ninguém questionar.
    expect(scraped).toMatch(
      /brabo_llm_call_duration_seconds_sum\{provider="ollama"\} 2\b/,
    );
  });

  it('expõe o histograma com buckets que cobrem a cauda longa', async () => {
    // Precisa de ao menos uma observação: um histograma sem amostra não emite
    // bucket nenhum no scrape.
    metrics.llmCallDuration.observe({ provider: 'anthropic' }, 45);

    const scraped = await metrics.scrape();

    // Um turno de agente longo passa de 30s. Buckets que param antes disso
    // tornam o p95 indistinguível de "+Inf" e o painel inútil.
    expect(scraped).toContain('brabo_llm_call_duration_seconds_bucket');
    expect(scraped).toMatch(/le="60"/);
  });

  it('conta decisões de ação por projeto e decisão', async () => {
    metrics.actionsDecided.inc({ project: 'proj-1', decision: 'approved' });
    metrics.actionsDecided.inc({ project: 'proj-1', decision: 'denied' });
    metrics.actionsDecided.inc({ project: 'proj-1', decision: 'denied' });

    const scraped = await metrics.scrape();

    expect(scraped).toMatch(
      /brabo_proposed_actions_decided_total\{[^}]*decision="approved"[^}]*\} 1/,
    );
    expect(scraped).toMatch(
      /brabo_proposed_actions_decided_total\{[^}]*decision="denied"[^}]*\} 2/,
    );
  });

  it('gauges de estado zeram por reset — série grudada mostraria trabalho que acabou', async () => {
    metrics.sessionsActive.set({ project: 'proj-1' }, 3);
    expect(await metrics.scrape()).toMatch(
      /brabo_sessions_active\{project="proj-1"\} 3/,
    );

    // É o que o DomainGaugesCollector faz antes de reescrever: sem o reset,
    // um projeto que zerou mantém o último valor para sempre.
    metrics.sessionsActive.reset();

    expect(await metrics.scrape()).not.toMatch(
      /brabo_sessions_active\{project="proj-1"\} 3/,
    );
  });

  it('serve no content-type que o Prometheus espera', () => {
    expect(metrics.contentType).toContain('text/plain');
  });
});
