import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openaiConfig } from '../../../src/infrastructure/llm/openai-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { subirServidorFalso } from '../../support/llm/fake-llm-server';

// AT-715 (RN-989): o conteúdo multimodal sai no formato OpenAI (HTTP falso).
describe('OpenAICompatibleProvider — conteúdo multimodal', () => {
  async function mensagensEnviadas(conversa: ChatMessage[]) {
    const servidor = await subirServidorFalso((_c, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    });
    const p = new OpenAICompatibleProvider(
      openaiConfig(servidor.baseUrl),
      new GptTokenizerEstimator(),
    );
    for await (const _ of p.chat(conversa, { model: 'm', apiKey: 'k' })) {
      // drena
    }
    const corpo = servidor.ultimoPedido() as unknown as {
      messages: { content: unknown }[];
    };
    await servidor.fechar();
    return corpo.messages;
  }

  it('imagem vira image_url com data URL; texto puro segue string', async () => {
    const m = await mensagensEnviadas([
      { role: 'system', content: 'regras' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'o que é isto?' },
          { type: 'image', mime: 'image/png', base64: 'AAAA' },
        ],
      },
    ]);
    expect(m[0].content).toBe('regras');
    expect(m[1].content).toEqual([
      { type: 'text', text: 'o que é isto?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });
});
