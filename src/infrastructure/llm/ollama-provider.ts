import { Injectable } from '@nestjs/common';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderName,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';

interface OllamaChatLine {
  message?: { content?: string };
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

    let response: Response;
    try {
      response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: options.model, messages, stream: true }),
      });
    } catch (error) {
      yield {
        type: 'error',
        message: `Falha ao conectar no Ollama: ${(error as Error).message}`,
      };
      return;
    }

    if (!response.ok || !response.body) {
      yield {
        type: 'error',
        message: `Ollama respondeu com status ${response.status}`,
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

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
