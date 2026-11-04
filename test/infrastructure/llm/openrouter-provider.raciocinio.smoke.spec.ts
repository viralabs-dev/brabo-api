import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';

/**
 * A PROVA que a capability `reasoningText` do OpenRouter exige antes de virar
 * `true` (AT-676, ADRs 0041/0249). Manual, opcional, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o motivo dito.
 *
 * Pergunta: um modelo que raciocina devolve TEXTO em chunk `reasoning`, e o
 * texto não vaza para o `text_delta`? `OPENROUTER_TEST_RACIOCINIO_MODEL` troca
 * o modelo (precisa expor o raciocínio pelo OpenRouter).
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_RACIOCINIO_MODEL ?? 'deepseek/deepseek-r1-0528';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`reasoningText` do OpenRouter (AT-676) foi PULADA.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — texto do raciocínio contra a API real (AT-676, manual)',
  () => {
    const provider = new OpenAICompatibleProvider(openrouterConfig());

    it('devolve chunk `reasoning` com texto e o `content` fica sem ele', async () => {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(
        [{ role: 'user', content: 'Quanto é 17 x 23? Responda só o número.' }],
        { model: modelo, apiKey, maxTokens: 512, reasoning: true },
      )) {
        chunks.push(c);
      }
      const erro = chunks.find((c) => c.type === 'error');
      expect(erro, JSON.stringify(erro)).toBeUndefined();
      const raciocinio = chunks
        .map((c) => (c.type === 'reasoning' ? c.text : ''))
        .join('');
      const texto = chunks
        .map((c) => (c.type === 'text_delta' ? c.text : ''))
        .join('');
      console.info(
        `[smoke] modelo=${modelo} raciocinio=${raciocinio.length} chars texto=${texto.length} chars`,
      );
      expect(raciocinio.length).toBeGreaterThan(0);
      expect(texto).toContain('391');
      expect(texto).not.toContain(raciocinio.slice(0, 40));
    }, 120_000);
  },
);
