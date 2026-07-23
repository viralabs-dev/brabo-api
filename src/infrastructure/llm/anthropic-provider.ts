import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderName,
} from '@brabo/shared';
import { LLMProvider } from '../../application/ports/llm-provider.port';

const DEFAULT_MAX_TOKENS = 4096;

@Injectable()
export class AnthropicProvider implements LLMProvider {
  readonly name: LLMProviderName = 'anthropic';

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk> {
    const client = new Anthropic({ apiKey: options.apiKey });

    const systemPrompt =
      messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n') || undefined;

    const conversation = messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));

    try {
      const stream = client.messages.stream({
        model: options.model,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: systemPrompt,
        messages: conversation,
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'usage',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        estimated: false,
      };
    } catch (error) {
      yield { type: 'error', message: (error as Error).message };
    }
  }
}
