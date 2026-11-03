import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';

/**
 * A PROVA que a capability `vision` do OpenRouter exige antes de virar `true`
 * (AT-715, ADR 0246, RN-989, ADR 0041). Manual, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe é PULADO, com o motivo dito. NÃO rode sem o
 * "pode seguir" do dono (gasta crédito). `OPENROUTER_TEST_VISION_MODEL` troca o
 * modelo.
 *
 * A imagem é um PNG 8x8 inteiro VERMELHO: o modelo tem de citar a cor.
 *   OPENROUTER_TEST_KEY=... pnpm --filter api exec vitest run \
 *     test/infrastructure/llm/openrouter-provider.visao.smoke.spec.ts
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_VISION_MODEL ?? 'google/gemini-2.5-flash';

// PNG 8x8 vermelho (zlib+CRC corretos), gerado uma vez.
const PNG_VERMELHO =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`vision` do OpenRouter (AT-715) foi PULADA.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — visão contra a API real (manual)',
  () => {
    const provider = new OpenAICompatibleProvider(openrouterConfig());

    it('descreve a cor da imagem enviada', async () => {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(
        [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Qual é a cor desta imagem? Responda com uma palavra em inglês.',
              },
              { type: 'image', mime: 'image/png', base64: PNG_VERMELHO },
            ],
          },
        ],
        { model: modelo, apiKey, maxTokens: 32 },
      )) {
        chunks.push(c);
      }
      const erro = chunks.find((c) => c.type === 'error');
      expect(erro, JSON.stringify(erro)).toBeUndefined();
      const texto = chunks
        .map((c) => (c.type === 'text_delta' ? c.text : ''))
        .join('');
      console.info(`[smoke] modelo=${modelo} resposta=${texto}`);
      expect(texto.toLowerCase()).toContain('red');
    }, 120_000);
  },
);
