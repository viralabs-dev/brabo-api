import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
  ToolCall,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';
import {
  LLMProviderError,
  LLMUpstreamError,
  normalizeHttpStatus,
} from '../../domain/llm/llm-provider-errors';
import {
  getJson,
  iterateLines,
  postStream,
  timeoutFromEnv,
} from './http-stream';

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
    // `GET /api/tags` verificado na doc oficial (backlog do ADR 0042
    // fechado), sem autenticação e sem paginação. O shape está em
    // `listModels` abaixo — e fica lá, não aqui: chave de objeto neste
    // literal quebra o extrator de capabilities do `docs:generate`, que casa
    // até o primeiro fecha-chave.
    listModels: true,
  };

  /**
   * O catálogo local, por `GET /api/tags` (Fase 9c — o backlog do ADR 0042).
   *
   * O que a doc oficial decidiu, e que não dá para adivinhar:
   *
   * 1. **Não tem autenticação nem paginação.** É um daemon local: devolve
   *    tudo o que foi puxado para a máquina, de uma vez. O `apiKey` do
   *    contrato é ignorado aqui, e isso é a resposta certa — não um descuido.
   * 2. **`name` é o identificador com a tag** (`qwen2.5-coder:7b`), que é
   *    exatamente o que vai em `options.model`. O campo `model` irmão traz o
   *    mesmo valor; usar `name` mantém o catálogo alinhado ao que o `chat`
   *    consome.
   * 3. **Não há preço nem janela de contexto.** Modelo local não tem preço, e
   *    `details` traz família e quantização, não `num_ctx`. Ambos ficam
   *    ausentes em vez de inventados (RN-042).
   *
   * O HOST vem do ambiente, não da chamada: `listModels` recebe só `apiKey`
   * pelo contrato, enquanto `chat` aceita `options.host`. Para um daemon que é
   * um por máquina isso basta — e é o mesmo default do `chat`, então os dois
   * nunca apontam para lugares diferentes.
   */
  async listModels(_apiKey?: string): Promise<ModeloDoCatalogo[]> {
    const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

    const { status, body } = await getJson({
      url: `${host}/api/tags`,
      headers: {},
      timeoutMs: timeoutFromEnv(TIMEOUT_ENV, DEFAULT_REQUEST_TIMEOUT_MS),
      timeoutEnvName: TIMEOUT_ENV,
      provider: this.name,
    });

    if (status < 200 || status >= 300) {
      throw normalizeHttpStatus(this.name, status, body);
    }

    let corpo: unknown;
    try {
      corpo = JSON.parse(body);
    } catch (error) {
      throw new LLMUpstreamError(
        this.name,
        'catálogo devolvido não é JSON válido',
        error,
      );
    }

    const modelos = (corpo as { models?: unknown }).models;
    if (!Array.isArray(modelos)) {
      // LANÇA em vez de devolver `[]`: lista vazia é indistinguível de "não há
      // modelo nenhum", e o sync leria como "sumiram todos" (RN-043).
      throw new LLMUpstreamError(
        this.name,
        'catálogo sem o array `models` que a doc do /api/tags descreve',
      );
    }

    return modelos
      .map((linha) => (linha as { name?: unknown }).name)
      .filter((nome): nome is string => typeof nome === 'string' && nome !== '')
      .map((name) => ({
        name,
        supportsToolCalling: this.capabilities.toolCalling,
      }));
  }

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
