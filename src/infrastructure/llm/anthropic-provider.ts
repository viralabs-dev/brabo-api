import { Inject, Injectable, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
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
 * oficial em vez de derivar da base compatível (Fase 9a — ADR 0040). O que
 * mudou aqui foi o alinhamento ao contrato: tool calling nativo, erros
 * normalizados por status e teto de inatividade via `withIdleTimeout`.
 */
@Injectable()
export class AnthropicProvider implements LLMProvider {
  readonly name: LLMProviderName = 'anthropic';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
  };

  constructor(
    @Optional()
    @Inject(ANTHROPIC_OPTIONS)
    private readonly options?: AnthropicOptions,
  ) {}

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
