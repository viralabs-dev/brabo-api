import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Métricas Prometheus da api (Fase 5, item 4).
 *
 * ## Por que contador e não consulta ao banco, para custo e tokens
 *
 * "tokens/min" e "custo/hora" são TAXAS. Em Prometheus a forma canônica de
 * expressar taxa é um contador monotônico, e o `rate()` deriva a janela que
 * quem consulta quiser — o dashboard pede por minuto, o alerta pede por hora,
 * e nenhum dos dois precisa de uma métrica própria. `rate()` também trata
 * reinício de processo (detecta a queda do contador), então réplica que
 * reinicia não vira pico nem buraco.
 *
 * O caminho oposto — gauge alimentada por `SELECT sum(...) WHERE created_at >
 * now() - interval` — teria que fixar a janela no código, faria uma varredura
 * na `token_usage` a cada scrape, e daria resposta errada com duas réplicas
 * (cada uma reportando o mesmo total, somado pelo Prometheus).
 *
 * ## E por que gauge para sessões ativas e tasks bloqueadas
 *
 * Essas duas são ESTADO, não evento: "quantas sessões estão ativas agora" não
 * se deriva de contador nenhum, porque não há evento de "deixou de estar
 * ativa" que sobreviva a um restart. Consulta periódica ao banco é a fonte
 * correta — e é por isso que a coleta é feita por um só lugar
 * (`DomainGaugesCollector`), com o mesmo valor reportado por qualquer réplica.
 */
@Injectable()
export class BraboMetrics {
  readonly registry = new Registry();

  /** Tokens consumidos. `kind` distingue input de output. */
  readonly llmTokens: Counter<
    'project' | 'provider' | 'upstream_provider' | 'kind'
  >;

  /** Custo em micro-dólar. `/1e6` dá dólar; `rate()*3600` dá custo/hora. */
  readonly llmCostMicros: Counter<'project' | 'provider' | 'upstream_provider'>;

  /** Duração da chamada de LLM. Buckets cobrem de 100ms a 2min. */
  readonly llmCallDuration: Histogram<'provider'>;

  readonly llmCallErrors: Counter<'provider'>;

  /** Decisões humanas sobre proposed_actions. `decision` = approved|denied. */
  readonly actionsDecided: Counter<'project' | 'decision'>;

  readonly sessionsActive: Gauge<'project'>;
  readonly sessionsClosing: Gauge<string>;
  readonly tasksBlocked: Gauge<'project'>;

  // Backup (Fase 5, item 6). Alimentados pelo DomainGaugesCollector a partir
  // da tabela `backup_runs`, que o CronJob escreve.
  readonly backupLastSuccessTimestamp: Gauge<string>;
  readonly backupAgeSeconds: Gauge<string>;
  readonly backupLastStatus: Gauge<string>;
  readonly backupSizeBytes: Gauge<string>;

  constructor() {
    // CPU, memória e event loop do processo. Baratas e é o que se olha
    // primeiro quando a api fica lenta.
    collectDefaultMetrics({ register: this.registry, prefix: 'brabo_api_' });

    this.llmTokens = new Counter({
      name: 'brabo_llm_tokens_total',
      help: 'Tokens de LLM consumidos, por projeto, provider, provider subjacente e tipo (input/output)',
      labelNames: ['project', 'provider', 'upstream_provider', 'kind'],
      registers: [this.registry],
    });

    this.llmCostMicros = new Counter({
      name: 'brabo_llm_cost_micros_total',
      help: 'Custo de LLM em micro-dólar (1 USD = 1e6), por projeto, provider e provider subjacente',
      labelNames: ['project', 'provider', 'upstream_provider'],
      registers: [this.registry],
    });

    this.llmCallDuration = new Histogram({
      name: 'brabo_llm_call_duration_seconds',
      help: 'Duração das chamadas de LLM, por provider',
      labelNames: ['provider'],
      // A cauda importa: uma chamada de 60s é normal para um turno longo, e
      // buckets que param em 10s tornariam o p95 inútil.
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
      registers: [this.registry],
    });

    this.llmCallErrors = new Counter({
      name: 'brabo_llm_call_errors_total',
      help: 'Chamadas de LLM que falharam, por provider',
      labelNames: ['provider'],
      registers: [this.registry],
    });

    this.actionsDecided = new Counter({
      name: 'brabo_proposed_actions_decided_total',
      help: 'Ações propostas decididas por uma pessoa, por projeto e decisão',
      labelNames: ['project', 'decision'],
      registers: [this.registry],
    });

    this.sessionsActive = new Gauge({
      name: 'brabo_sessions_active',
      help: 'Sessões em status active, por projeto',
      labelNames: ['project'],
      registers: [this.registry],
    });

    this.sessionsClosing = new Gauge({
      name: 'brabo_sessions_closing',
      help: 'Sessões em status closing — estado de passagem; parado aqui é sintoma',
      registers: [this.registry],
    });

    this.tasksBlocked = new Gauge({
      name: 'brabo_tasks_blocked',
      help: 'Tasks com blocked = true, por projeto',
      labelNames: ['project'],
      registers: [this.registry],
    });

    this.backupLastSuccessTimestamp = new Gauge({
      name: 'brabo_backup_last_success_timestamp_seconds',
      help: 'Epoch em segundos do último backup concluído com sucesso',
      registers: [this.registry],
    });

    // Derivada do gauge acima, mas publicada explicitamente: o alerta é
    // "backup velho", e escrever isso como `time() - gauge` na regra esconde
    // o caso em que NUNCA houve sucesso — ali o gauge é 0 e a subtração dá a
    // idade do epoch, que dispara por acidente e não por diagnóstico.
    // Aqui a ausência de backup é representada explicitamente (ver o
    // collector) em vez de virar um número gigante sem significado.
    this.backupAgeSeconds = new Gauge({
      name: 'brabo_backup_age_seconds',
      help: 'Idade em segundos do último backup bem-sucedido (-1 se nunca houve)',
      registers: [this.registry],
    });

    this.backupLastStatus = new Gauge({
      name: 'brabo_backup_last_status',
      help: 'Resultado da ÚLTIMA execução do backup: 1 = ok, 0 = falhou, -1 = nunca rodou',
      registers: [this.registry],
    });

    this.backupSizeBytes = new Gauge({
      name: 'brabo_backup_size_bytes',
      help: 'Tamanho em bytes do último backup bem-sucedido — queda brusca é sinal de dump truncado',
      registers: [this.registry],
    });
  }

  /**
   * Registra o consumo de uma chamada de LLM. Chamado de um lugar só
   * (`RecordLlmUsageUseCase`), que já é o único caminho de metering do
   * sistema — a métrica herda essa garantia de graça.
   */
  recordLlmUsage(input: {
    projectId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costMicros: number;
    latencyMs: number;
    /** Quem serviu de fato, quando a chamada passou por um hub (Fase 9b). */
    upstreamProvider?: string | null;
  }): void {
    const { projectId: project, provider } = input;
    // Sem hub, o subjacente É o próprio provider. Rotular assim (em vez de
    // deixar vazio) mantém `sum by (upstream_provider)` somando o custo
    // INTEIRO — com rótulo vazio, o painel mostraria só o que passou por hub e
    // pareceria que o resto não custou nada.
    const upstream_provider = input.upstreamProvider ?? provider;

    this.llmTokens.inc(
      { project, provider, upstream_provider, kind: 'input' },
      input.inputTokens,
    );
    this.llmTokens.inc(
      { project, provider, upstream_provider, kind: 'output' },
      input.outputTokens,
    );
    this.llmCostMicros.inc(
      { project, provider, upstream_provider },
      input.costMicros,
    );
    this.llmCallDuration.observe({ provider }, input.latencyMs / 1000);
  }

  async scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
