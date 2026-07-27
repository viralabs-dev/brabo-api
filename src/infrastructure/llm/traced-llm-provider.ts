import { SpanStatusCode, trace } from '@opentelemetry/api';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderName,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import { BraboMetrics } from '../observability/brabo-metrics';

/**
 * Envolve um `LLMProvider` com span e métrica de erro (Fase 5, item 3).
 *
 * ## Por que um decorator, e não instrumentar os três providers
 *
 * `LLMProviderRegistryImpl.get()` é o funil único por onde toda chamada de LLM
 * passa. Um decorator ali cobre Ollama, Anthropic e OpenAI de uma vez, e cobre
 * qualquer provider futuro sem que alguém precise lembrar de instrumentá-lo —
 * que é exatamente o tipo de coisa que se esquece.
 *
 * A auto-instrumentação de `http`/`undici` já cria uma span de requisição para
 * cada uma dessas chamadas. Esta span é a camada de cima: agrupa o STREAM
 * INTEIRO (que pode ser dezenas de requisições ou um único SSE longo) numa
 * operação só, com os atributos que interessam ao domínio.
 *
 * A duração de sucesso não é registrada aqui: quem a registra é
 * `RecordLlmUsageUseCase`, junto com tokens e custo, para que a latência da
 * métrica e a do metering sejam sempre o mesmo número. Aqui só contamos ERRO —
 * uma chamada que falha nunca chega ao metering, e sem isto seria invisível.
 */
export class TracedLLMProvider extends LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly metrics: BraboMetrics,
  ) {
    super();
  }

  get name(): LLMProviderName {
    return this.inner.name;
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const tracer = trace.getTracer('brabo-api');
    const span = tracer.startSpan('llm.call', {
      attributes: {
        // Convenção `gen_ai.*` do OpenTelemetry: é o que faz o Grafana e
        // qualquer backend reconhecerem isto como chamada de modelo em vez de
        // um span genérico.
        'gen_ai.system': this.inner.name,
        'gen_ai.request.model': options.model,
        'brabo.llm.messages': messages.length,
      },
    });

    try {
      // `yield*` preserva o streaming: o consumidor continua recebendo chunk a
      // chunk, e a span fecha quando o gerador termina. Materializar a stream
      // aqui para medi-la mudaria o comportamento do chat ao vivo.
      yield* this.inner.chat(messages, options);
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      this.metrics.llmCallErrors.inc({ provider: this.inner.name });
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;
    } finally {
      span.end();
    }
  }
}
