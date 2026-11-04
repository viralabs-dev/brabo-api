import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';

/**
 * A PROVA que a capability `reasoningText` da Anthropic exige antes de virar
 * `true` (AT-676, ADRs 0041/0249). Manual, opcional, contra a API real — sem
 * `ANTHROPIC_TEST_KEY` o describe inteiro é PULADO, com o motivo dito.
 *
 * Pergunta: com `thinking` ligado, o stream devolve TEXTO em chunk
 * `reasoning` (`thinking_delta`), o texto não vaza para o `text_delta`, e a
 * resposta final traz os `thinkingBlocks` assinados que a chamada seguinte
 * devolve? `ANTHROPIC_TEST_RACIOCINIO_MODEL` troca o modelo.
 */
const apiKey = process.env.ANTHROPIC_TEST_KEY;
const modelo =
  process.env.ANTHROPIC_TEST_RACIOCINIO_MODEL ?? 'claude-haiku-5-5';

if (!apiKey) {
  console.warn(
    '[smoke] ANTHROPIC_TEST_KEY não definido — a prova da capability ' +
      '`reasoningText` da Anthropic (AT-676) foi PULADA.',
  );
}

describe.skipIf(!apiKey)(
  'Anthropic — texto do raciocínio contra a API real (AT-676, manual)',
  () => {
    const provider = new AnthropicProvider();

    it('devolve chunk `reasoning` com texto e o `content` fica sem ele', async () => {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(
        [{ role: 'user', content: 'Quanto é 17 x 23? Responda só o número.' }],
        {
          model: modelo,
          apiKey,
          maxTokens: 4096,
          reasoning: true,
          reasoningBudget: 1024,
        },
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
      console.log(
        `[smoke] ${modelo}: raciocínio ${raciocinio.length} caracteres, resposta ${JSON.stringify(texto.trim())}`,
      );
      expect(raciocinio.length).toBeGreaterThan(0);
      expect(texto).toContain('391');
      expect(texto).not.toContain(raciocinio.slice(0, 40));
    });
  },
);
