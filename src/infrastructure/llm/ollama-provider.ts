import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ToolCall,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import {
  LLMProviderError,
  LLMUpstreamError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import { iterateLines, postStream, timeoutFromEnv } from './http-stream';

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> };
}

interface OllamaChatLine {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

@Injectable()
export class OllamaProvider implements LLMProvider {
  readonly name: LLMProviderName = 'ollama';
  readonly capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolCalling: true,
    // O Ollama tem `GET /api/tags`, mas o formato dele NÃO foi verificado na
    // doc oficial nesta fase — e a regra da Fase 9b/9c é não codar contra um
    // contrato adivinhado. Declarar `false` faz o sync pular explicitamente,
    // que é honesto; declarar `true` e errar o parsing marcaria o catálogo
    // inteiro como indisponível. Ver o backlog do ADR 0042.
    listModels: false,
  };

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const host =
      options.host ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434';

    const body = JSON.stringify({
      model: options.model,
      messages,
      stream: true,
      // Ollama só aceita `tools` quando há alguma; mandar [] em modelos
      // sem suporte pode dar erro, então só inclui quando há tools.
      ...(options.tools && options.tools.length > 0
        ? { tools: toOllamaTools(options.tools) }
        : {}),
    });

    let response: IncomingMessage;
    try {
      response = await postStream({
        url: `${host}/api/chat`,
        body,
        headers: {},
        timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
        timeoutEnvName: TIMEOUT_ENV,
        provider: this.name,
      });
    } catch (error) {
      // O prefixo é mantido palavra por palavra desde o ADR 0020 — é por ele
      // que se reconhece esta falha nos logs de produção e nos testes.
      yield {
        type: 'error',
        code: codigoDe(error),
        message: `Falha ao conectar no Ollama: ${(error as Error).message}`,
      };
      return;
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      yield {
        type: 'error',
        code: normalizeHttpStatus(this.name, status).code,
        message: `Ollama respondeu com status ${status}`,
      };
      return;
    }

    try {
      for await (const line of iterateLines(response)) {
        let parsed: OllamaChatLine;
        try {
          parsed = JSON.parse(line) as OllamaChatLine;
        } catch {
          continue; // linha corrompida/parcial — ignora, não derruba o stream
        }

        if (parsed.message?.content) {
          yield { type: 'text_delta', text: parsed.message.content };
        }
        const toolCalls = parseToolCalls(parsed.message?.tool_calls);
        if (toolCalls.length > 0) {
          yield { type: 'tool_calls', toolCalls };
        }
        if (parsed.done) {
          yield {
            type: 'usage',
            inputTokens: parsed.prompt_eval_count ?? 0,
            outputTokens: parsed.eval_count ?? 0,
            estimated: false,
          };
        }
      }
    } catch (error) {
      yield {
        type: 'error',
        code: codigoDe(error),
        message: `Stream do Ollama interrompido: ${(error as Error).message}`,
      };
    }
  }
}

// Teto de INATIVIDADE do socket (não de duração total) — ver a explicação
// completa em http-stream.ts. O Ollama tem env própria porque um modelo local
// tem outra ordem de grandeza de latência até o primeiro token.
const TIMEOUT_ENV = 'OLLAMA_REQUEST_TIMEOUT_MS';
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

function codigoDe(error: unknown) {
  return error instanceof LLMProviderError
    ? error.code
    : new LLMUpstreamError('ollama', String(error)).code;
}

function toOllamaTools(tools: NonNullable<ChatOptions['tools']>) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseToolCalls(raw: OllamaToolCall[] | undefined): ToolCall[] {
  if (!raw) return [];
  return raw
    .filter((tc) => tc.function?.name)
    .map((tc) => ({
      id: randomUUID(),
      name: tc.function!.name!,
      arguments: tc.function!.arguments ?? {},
    }));
}
