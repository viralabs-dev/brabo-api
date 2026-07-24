import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderName,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';

@Injectable()
export class OpenAIProvider implements LLMProvider {
  readonly name: LLMProviderName = 'openai';

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const client = new OpenAI({ apiKey: options.apiKey });

    try {
      const stream = await client.chat.completions.create({
        model: options.model,
        // Tool calling não é suportado neste provider ainda (só o Ollama,
        // Fase 3a) — os callers atuais só mandam user/assistant/system em
        // texto. O cast reflete isso: se um dia OpenAI ganhar tools, o
        // mapeamento por role precisa ser explícito.
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })) as OpenAI.Chat.ChatCompletionMessageParam[],
        max_tokens: options.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { type: 'text_delta', text: delta };

        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            estimated: false,
          };
        }
      }
    } catch (error) {
      yield { type: 'error', message: (error as Error).message };
    }
  }
}
