import { Inject, Injectable, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
  ToolCall,
  ToolDef,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import {
  LLMConnectionError,
  LLMTimeoutError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import { withIdleTimeout } from './idle-timeout';
import { LLM_TIMEOUT_ENV, toErrorChunk } from './openai-compatible-provider';
import { timeoutFromEnv } from './http-stream';

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Token de DI para os overrides que só a suite de contrato usa. */
export const ANTHROPIC_OPTIONS = 'ANTHROPIC_OPTIONS';

export interface AnthropicOptions {
  /** Aponta o SDK para outro host (servidor falso da suite de contrato). */
  baseURL?: string;
  /**
   * O SDK repete 429 e 5xx sozinho. No teste de rate limit isso transformaria
   * uma asserção de um segundo em vários — e escondia qual resposta foi
   * classificada.
   */
  maxRetries?: number;
}

/**
 * O Anthropic NÃO fala o dialeto `/chat/completions`, então continua no SDK
 * oficial em vez de derivar da base compatível (Fase 9a — ADR 0041). O que
 * mudou aqui foi o alinhamento ao contrato: tool calling nativo, erros
 * normalizados por status e teto de inatividade via `withIdleTimeout`.
 */
@Injectable()
export class AnthropicProvider implements LLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    // `GET /v1/models` verificado na doc oficial (backlog do ADR 0042
    // fechado), paginado por cursor. O shape está em `listModels` abaixo —
    // e fica lá, não aqui: chave de objeto neste literal quebra o extrator
    // de capabilities do `docs:generate`, que casa até o primeiro fecha-chave.
    listModels: true,
    // A Anthropic não tem endpoint de embedding próprio — a doc dela manda
    // usar um terceiro (Voyage AI), que é OUTRO provider, com outra chave e
    // outro dialeto. Aqui `false` não é falta de prova: é ausência da
    // operação, e por isso este é o único dos nove que não vira `true` nem
    // com credencial na mão (ADR 0075).
    embeddings: false,
  };

  constructor(
    @Optional()
    @Inject(ANTHROPIC_OPTIONS)
    private readonly options?: AnthropicOptions,
  ) {}

  /**
   * O catálogo remoto, por `GET /v1/models` (Fase 9c — o backlog do ADR 0042).
   *
   * Três coisas que a doc oficial decidiu, e que não dá para adivinhar:
   *
   * 1. **É paginado por cursor**, não por offset: `has_more` + `last_id` como
   *    `after_id` da próxima página, com `limit` de 1 a 1000. O
   *    `client.models.list` do SDK já expõe iteração automática, e é ela que
   *    usamos — reimplementar o laço de cursor à mão seria repetir código que
   *    o SDK mantém.
   * 2. **`max_input_tokens` é a janela de contexto**, e é o único campo que o
   *    catálogo do Brabo consegue aproveitar além do id e do nome legível.
   * 3. **Preço NÃO vem** nesta resposta. Por isso `inputPricePerMillionMicros`
   *    e o par de saída ficam ausentes, e o modelo entra no catálogo sem
   *    preço em vez de com preço inventado (RN-042 — o custo gravado tem que
   *    ser reproduzível).
   *
   * Erro LANÇA, como o contrato exige: lista vazia seria lida pelo sync como
   * "sumiram todos" e indisponibilizaria o catálogo inteiro (RN-043).
   */
  async listModels(apiKey?: string): Promise<ModeloDoCatalogo[]> {
    const client = new Anthropic({
      apiKey,
      ...(this.options?.baseURL ? { baseURL: this.options.baseURL } : {}),
      ...(this.options?.maxRetries !== undefined
        ? { maxRetries: this.options.maxRetries }
        : {}),
    });

    try {
      const modelos: ModeloDoCatalogo[] = [];

      // `limit: 1000` é o teto documentado. Com a auto-paginação do SDK, o
      // limite alto só reduz o número de idas à rede — não muda o resultado.
      for await (const modelo of client.models.list({ limit: 1000 })) {
        modelos.push({
          name: modelo.id,
          displayName: modelo.display_name,
          // `max_input_tokens` pode vir 0 quando o provider não o declara
          // para aquele modelo; 0 não é janela, é ausência.
          ...(typeof modelo.max_input_tokens === 'number' &&
          modelo.max_input_tokens > 0
            ? { contextLength: modelo.max_input_tokens }
            : {}),
          // Todo modelo servido pela Messages API aceita `tools`.
          supportsToolCalling: true,
        });
      }

      return modelos;
    } catch (error) {
      // O MESMO `normalize` do `chat`, e não um tratamento paralelo: é ele que
      // mapeia timeout, falha de conexão e status HTTP para os erros
      // normalizados por `code` (ADR 0041). Aqui o resultado é LANÇADO em vez
      // de virar chunk — não há turno em andamento para preservar.
      throw this.normalize(error);
    }
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const client = new Anthropic({
      apiKey: options.apiKey,
      ...(this.options?.baseURL ? { baseURL: this.options.baseURL } : {}),
      ...(this.options?.maxRetries !== undefined
        ? { maxRetries: this.options.maxRetries }
        : {}),
    });

    const systemPrompt =
      messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') || undefined;

    const conversation = toConversation(
      messages.filter((message) => message.role !== 'system'),
    );

    const tetoDeInatividade = timeoutFromEnv(
      LLM_TIMEOUT_ENV,
      DEFAULT_TIMEOUT_MS,
    );

    try {
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: systemPrompt,
        messages: conversation,
        ...(options.tools && options.tools.length > 0
          ? { tools: options.tools.map(toAnthropicTool) }
          : {}),
      });

      const eventos = withIdleTimeout(
        stream,
        tetoDeInatividade,
        () =>
          new LLMTimeoutError(
            this.name,
            `sem resposta após ${tetoDeInatividade}ms (${LLM_TIMEOUT_ENV})`,
          ),
      );

      for await (const event of eventos) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      // Os blocos `tool_use` vêm fatiados em `input_json_delta`; o SDK já
      // remonta e desserializa o `input`, então lê-los da mensagem final custa
      // menos e erra menos que reimplementar a costura aqui. Como no Ollama,
      // o consumidor recebe as chamadas de uma vez só, não incrementalmente.
      const finalMessage = await stream.finalMessage();

      const toolCalls = toToolCalls(finalMessage.content);
      if (toolCalls.length > 0) yield { type: 'tool_calls', toolCalls };

      yield {
        type: 'usage',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        estimated: false,
      };
    } catch (error) {
      yield toErrorChunk(this.normalize(error), this.name);
    }
  }

  private normalize(error: unknown): unknown {
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new LLMTimeoutError(this.name, error.message, error);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new LLMConnectionError(this.name, error.message, error);
    }
    if (
      error instanceof Anthropic.APIError &&
      typeof error.status === 'number'
    ) {
      return normalizeHttpStatus(
        this.name,
        error.status,
        typeof error.message === 'string' ? error.message : undefined,
      );
    }
    return error;
  }
}

// --- Mapeamento ---

type BlocoDeConteudo =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface TurnoAnthropic {
  role: 'user' | 'assistant';
  content: string | BlocoDeConteudo[];
}

/**
 * O Anthropic não tem papel `tool`: o resultado de uma ferramenta é um bloco
 * `tool_result` dentro de um turno de USER, e resultados de chamadas paralelas
 * precisam vir no MESMO turno. Por isso mensagens `tool` consecutivas são
 * agrupadas — antes disto elas eram achatadas em texto de `user`, o que fazia
 * o modelo perder o vínculo com a chamada que as originou.
 */
function toConversation(messages: ChatMessage[]): TurnoAnthropic[] {
  const turnos: TurnoAnthropic[] = [];

  for (const message of messages) {
    if (message.role === 'tool') {
      const bloco: BlocoDeConteudo = {
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? '',
        content: message.content,
      };

      const ultimo = turnos.at(-1);
      if (ultimo && ultimo.role === 'user' && Array.isArray(ultimo.content)) {
        ultimo.content.push(bloco);
      } else {
        turnos.push({ role: 'user', content: [bloco] });
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const blocos: BlocoDeConteudo[] = [];
      if (message.content) {
        blocos.push({ type: 'text', text: message.content });
      }
      for (const chamada of message.toolCalls) {
        blocos.push({
          type: 'tool_use',
          id: chamada.id,
          name: chamada.name,
          input: chamada.arguments,
        });
      }
      turnos.push({ role: 'assistant', content: blocos });
      continue;
    }

    turnos.push({
      role: message.role as 'user' | 'assistant',
      content: message.content,
    });
  }

  return turnos;
}

function toAnthropicTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as { type: 'object' },
  };
}

function toToolCalls(content: { type: string }[]): ToolCall[] {
  return content
    .filter(
      (
        bloco,
      ): bloco is {
        type: 'tool_use';
        id: string;
        name: string;
        input: unknown;
      } => bloco.type === 'tool_use',
    )
    .map((bloco) => ({
      id: bloco.id,
      name: bloco.name,
      arguments:
        typeof bloco.input === 'object' && bloco.input !== null
          ? (bloco.input as Record<string, unknown>)
          : {},
    }));
}
