import { randomUUID } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderName,
  ToolCall,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';

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
      response = await postStream(`${host}/api/chat`, body, requestTimeoutMs());
    } catch (error) {
      yield {
        type: 'error',
        message: `Falha ao conectar no Ollama: ${(error as Error).message}`,
      };
      return;
    }

    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      yield {
        type: 'error',
        message: `Ollama respondeu com status ${status}`,
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for await (const chunk of response) {
        buffer += decoder.decode(chunk as Buffer, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line) continue;

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
      }
    } catch (error) {
      yield {
        type: 'error',
        message: `Stream do Ollama interrompido: ${(error as Error).message}`,
      };
    }
  }
}

// Teto de INATIVIDADE do socket (não de duração total): vale tanto pra "o
// Ollama ainda não mandou os headers" quanto pra "parou de mandar chunks no
// meio do stream". Um turno legítimo pode demorar muito — modelo local
// processa milhares de tokens de prompt antes do primeiro token, e requisições
// de agentes diferentes se enfileiram no provider — mas nunca fica QUIETO por
// muito tempo.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

function requestTimeoutMs(): number {
  const bruto = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS);
  return Number.isFinite(bruto) && bruto > 0 ? bruto : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * POST com resposta em streaming, via `node:http`.
 *
 * Por que não `fetch`: o timeout de headers do undici (300s, fixo) só é
 * configurável passando um `dispatcher` próprio, que exige a dependência
 * `undici`. Na prática o `LLM_TURN_TIMEOUT_MS` do engine não valia nada — o
 * `fetch` desistia antes com um opaco "fetch failed", e o agente registrava
 * "o modelo parou" pra uma requisição que nunca foi respondida (ADR 0020).
 */
function postStream(
  url: string,
  body: string,
  timeoutMs: number,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const send = alvo.protocol === 'https:' ? httpsRequest : httpRequest;

    const req = send(
      alvo,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      resolve,
    );

    // `timeout` só EMITE o evento; sem destruir o socket a requisição ficaria
    // pendurada pra sempre mesmo depois de estourar.
    req.on('timeout', () => {
      req.destroy(
        new Error(`sem resposta após ${timeoutMs}ms (OLLAMA_REQUEST_TIMEOUT_MS)`),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
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
