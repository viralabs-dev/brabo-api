import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ToolCall,
  ToolDef,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import type { TokenEstimator } from '../../application/ports/token-estimator.port';
import {
  LLMProviderError,
  LLMUpstreamError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import {
  iterateSseData,
  postStream,
  readBody,
  timeoutFromEnv,
} from './http-stream';

/**
 * Teto de inatividade dos providers de API (o Ollama tem o seu, porque um
 * modelo local tem outra ordem de grandeza de latência de primeiro token).
 */
export const LLM_TIMEOUT_ENV = 'LLM_REQUEST_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Particularidades conhecidas entre implementações do dialeto
 * `/chat/completions`. Cada flag existe porque um provider real diverge — não
 * antecipe flags sem um provider que precise dela (Fase 9b confirma cada uma
 * na doc oficial do provider durante a implementação).
 */
export interface OpenAICompatibleFlags {
  /**
   * `stream_options: { include_usage: true }` é como a OpenAI devolve tokens
   * num stream. Vários clones rejeitam o campo com 400 e mandam `usage` de
   * qualquer jeito no frame final.
   */
  readonly streamOptionsIncludeUsage: boolean;
  /** A OpenAI renomeou `max_tokens` para `max_completion_tokens`. */
  readonly maxTokensField: 'max_tokens' | 'max_completion_tokens';
}

export interface OpenAICompatibleConfig {
  readonly name: LLMProviderName;
  /** Sem barra no fim — `/chat/completions` é concatenado. */
  readonly baseUrl: string;
  readonly capabilities: LLMProviderCapabilities;
  readonly authHeaders: (apiKey?: string) => Record<string, string>;
  readonly flags: OpenAICompatibleFlags;
}

/**
 * Base configurável para todo provider que fala o dialeto `/chat/completions`
 * da OpenAI (Fase 9a — ADR 0040). A própria OpenAI é uma instância dela; NVIDIA
 * NIM, Deep Infra, Together, Bitdeer, Vultr e OpenRouter nascem da mesma base
 * na Fase 9b, mudando `baseUrl`, header de auth e flags — não o parsing.
 *
 * O contrato que ela cumpre está em `test/contract/llm-provider.contract.ts`.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: LLMProviderName;
  readonly capabilities: LLMProviderCapabilities;

  constructor(
    protected readonly config: OpenAICompatibleConfig,
    /**
     * Só é usado quando a resposta NÃO traz `usage` — aí a contagem local
     * entra marcada como `estimated`, e é isso que distingue "o provider
     * disse 0 tokens" de "o provider não disse nada".
     */
    private readonly tokenEstimator?: TokenEstimator,
  ) {
    this.name = config.name;
    this.capabilities = config.capabilities;
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const corpo = JSON.stringify(this.buildBody(messages, options));

    let response: IncomingMessage;
    try {
      response = await postStream({
        url: `${this.config.baseUrl}/chat/completions`,
        body: corpo,
        headers: this.config.authHeaders(options.apiKey),
        timeoutMs: timeoutFromEnv(LLM_TIMEOUT_ENV, DEFAULT_TIMEOUT_MS),
        timeoutEnvName: LLM_TIMEOUT_ENV,
        provider: this.name,
      });
    } catch (error) {
      yield toErrorChunk(error, this.name);
      return;
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      const corpoDoErro = await readBody(response);
      yield toErrorChunk(
        normalizeHttpStatus(this.name, status, corpoDoErro),
        this.name,
      );
      return;
    }

    const emAndamento = new Map<number, ToolCallEmMontagem>();
    let usageRecebido = false;
    let textoAcumulado = '';

    try {
      for await (const payload of iterateSseData(response)) {
        let frame: FrameDeChat;
        try {
          frame = JSON.parse(payload) as FrameDeChat;
        } catch {
          continue; // frame corrompido/parcial — ignora, não derruba o stream
        }

        const delta = frame.choices?.[0]?.delta;

        if (delta?.content) {
          textoAcumulado += delta.content;
          yield { type: 'text_delta', text: delta.content };
        }

        // `tool_calls` chega FATIADO: o primeiro frame traz id e nome, e os
        // seguintes trazem pedaços da string de `arguments`. Só dá para
        // desserializar quando o stream fecha.
        for (const parcial of delta?.tool_calls ?? []) {
          acumular(emAndamento, parcial);
        }

        if (frame.usage) {
          usageRecebido = true;
          yield {
            type: 'usage',
            inputTokens: frame.usage.prompt_tokens ?? 0,
            outputTokens: frame.usage.completion_tokens ?? 0,
            estimated: false,
          };
        }
      }
    } catch (error) {
      yield toErrorChunk(error, this.name);
      return;
    }

    const toolCalls = finalizar(emAndamento);
    if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls };

    if (!usageRecebido && this.tokenEstimator) {
      yield {
        type: 'usage',
        inputTokens: this.tokenEstimator.count(
          messages.map((m) => m.content).join('\n'),
        ),
        outputTokens: this.tokenEstimator.count(textoAcumulado),
        estimated: true,
      };
    }
  }

  private buildBody(messages: ChatMessage[], options: ChatOptions) {
    const { flags } = this.config;

    return {
      model: options.model,
      messages: messages.map(toWireMessage),
      stream: true,
      ...(options.maxTokens !== undefined
        ? { [flags.maxTokensField]: options.maxTokens }
        : {}),
      ...(flags.streamOptionsIncludeUsage
        ? { stream_options: { include_usage: true } }
        : {}),
      // Mandar `tools: []` faz alguns compatíveis responderem 400 — só inclui
      // quando há ferramenta, e só quando o provider declara saber usá-las.
      ...(this.capabilities.toolCalling &&
      options.tools &&
      options.tools.length > 0
        ? { tools: options.tools.map(toWireTool) }
        : {}),
    };
  }
}

// --- Mapeamento para o formato de fio ---

interface WireMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
}

function toWireMessage(message: ChatMessage): WireMessage {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId ?? '',
      ...(message.name ? { name: message.name } : {}),
    };
  }

  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content,
      tool_calls: message.toolCalls.map((chamada) => ({
        id: chamada.id,
        type: 'function' as const,
        function: {
          name: chamada.name,
          arguments: JSON.stringify(chamada.arguments),
        },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

function toWireTool(tool: ToolDef) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// --- Parsing do stream ---

interface FrameDeChat {
  choices?: {
    delta?: {
      content?: string;
      tool_calls?: ToolCallParcial[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface ToolCallParcial {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface ToolCallEmMontagem {
  id?: string;
  name?: string;
  argumentos: string;
}

function acumular(
  emAndamento: Map<number, ToolCallEmMontagem>,
  parcial: ToolCallParcial,
): void {
  const indice = parcial.index ?? 0;
  const atual = emAndamento.get(indice) ?? { argumentos: '' };

  if (parcial.id) atual.id = parcial.id;
  if (parcial.function?.name) atual.name = parcial.function.name;
  if (parcial.function?.arguments) {
    atual.argumentos += parcial.function.arguments;
  }

  emAndamento.set(indice, atual);
}

function finalizar(emAndamento: Map<number, ToolCallEmMontagem>): ToolCall[] {
  return [...emAndamento.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, montagem]) => montagem.name)
    .map(([, montagem]) => ({
      // Nem todo compatível devolve id — o ToolLoop precisa de um para casar
      // a resposta da ferramenta, então geramos como o Ollama já faz.
      id: montagem.id ?? randomUUID(),
      name: montagem.name!,
      arguments: parseArgumentos(montagem.argumentos),
    }));
}

function parseArgumentos(bruto: string): Record<string, unknown> {
  if (!bruto.trim()) return {};
  try {
    const parseado: unknown = JSON.parse(bruto);
    return typeof parseado === 'object' && parseado !== null
      ? (parseado as Record<string, unknown>)
      : {};
  } catch {
    // Argumentos truncados (stream cortado no meio) não podem virar exceção:
    // o ToolLoop trata ferramenta sem argumento, mas não trata turno perdido.
    return {};
  }
}

export function toErrorChunk(
  error: unknown,
  provider: LLMProviderName,
): ChatStreamChunk {
  const normalizado =
    error instanceof LLMProviderError
      ? error
      : new LLMUpstreamError(provider, (error as Error).message, error);

  return {
    type: 'error',
    code: normalizado.code,
    message: normalizado.message,
  };
}
