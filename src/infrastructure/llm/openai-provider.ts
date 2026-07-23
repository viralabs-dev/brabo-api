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
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
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
