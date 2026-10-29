import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';
import { FATOR_DO_TETO_DE_PRECO } from '../../../src/domain/llm/routing-preference';

/**
 * A PROVA que a capability `priceCeiling` do OpenRouter exige antes de virar
 * `true` (ADR 0225, RN-917). Manual, opcional, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o motivo dito.
 *
 * Prova três coisas: (1) com `max_price` = catálogo × 1,5 o upstream que serviu
 * tem preço (entrada E saída) dentro do teto, conferido contra a lista pública
 * de endpoints (gratuita); (2) `sort` + `max_price` no mesmo corpo é aceito e
 * respeita o teto (a mescla do objeto `provider`); (3) o controle, com teto
 * impossível, devolve o erro NOMEADO `price_ceiling` e não cobra.
 * Teto de gasto do smoke: US$ 0,01, contado por `usage.cost`.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_CEILING_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const TETO_DE_GASTO_MICROS = 10_000; // US$ 0,01
const CHAMADAS_COM_TETO = 3;
const BASE = 'https://openrouter.ai/api/v1';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`priceCeiling` do OpenRouter (ADR 0225) foi PULADA.',
  );
}

interface Endpoint {
  provider_name: string;
  pricing: { prompt: string; completion: string };
}

describe.skipIf(!apiKey)(
  'OpenRouter — `provider.max_price` contra a API real (ADR 0225, manual)',
  () => {
    const base = openrouterConfig();
    // Liga a capability à força: a pergunta é "se fosse true, o hub respeitaria?".
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, priceCeiling: true },
    });
    let gastoMicros = 0;

    async function chamar(extra: Record<string, unknown>) {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(
        [{ role: 'user', content: 'Responda só: ok' }],
        { model: modelo, apiKey, maxTokens: 8, ...extra },
      )) {
        chunks.push(c);
      }
      const usage = chunks.find((c) => c.type === 'usage');
      if (usage?.type === 'usage') gastoMicros += usage.costMicros ?? 0;
      expect(
        gastoMicros,
        `gasto do smoke passou de US$ 0,01 (${gastoMicros} micros)`,
      ).toBeLessThanOrEqual(TETO_DE_GASTO_MICROS);
      return chunks;
    }

    async function lerPrecos() {
      const [cat, ends] = await Promise.all([
        fetch(`${BASE}/models`).then((r) => r.json() as Promise<unknown>),
        fetch(`${BASE}/models/${modelo}/endpoints`).then(
          (r) => r.json() as Promise<unknown>,
        ),
      ]);
      const linha = (
        cat as {
          data: {
            id: string;
            pricing: { prompt: string; completion: string };
          }[];
        }
      ).data.find((m) => m.id === modelo);
      expect(linha, `modelo ${modelo} fora do catálogo`).toBeDefined();
      // USD por token -> micro-USD por milhão de tokens.
      const microsPorM = (usdPorToken: string) => Number(usdPorToken) * 1e12;
      const teto = {
        inputPerMillionMicros: Math.round(
          microsPorM(linha!.pricing.prompt) * FATOR_DO_TETO_DE_PRECO,
        ),
        outputPerMillionMicros: Math.round(
          microsPorM(linha!.pricing.completion) * FATOR_DO_TETO_DE_PRECO,
        ),
      };
      const dentro = new Set(
        (ends as { data: { endpoints: Endpoint[] } }).data.endpoints
          .filter(
            (e) =>
              microsPorM(e.pricing.prompt) <= teto.inputPerMillionMicros &&
              microsPorM(e.pricing.completion) <= teto.outputPerMillionMicros,
          )
          .map((e) => e.provider_name.toLowerCase()),
      );
      return { teto, dentro };
    }

    it('o upstream servido cabe no teto; sort + teto convivem; teto impossível dá price_ceiling', async () => {
      const { teto, dentro } = await lerPrecos();
      expect(dentro.size).toBeGreaterThan(0);
      const servidos: string[] = [];

      for (let i = 0; i < CHAMADAS_COM_TETO; i++) {
        const chunks = await chamar({
          priceCeiling: teto,
          sessionKey: `brabo:smoke-teto-${Date.now()}:dev-teste`,
        });
        expect(chunks.find((c) => c.type === 'error')).toBeUndefined();
        const u = chunks.find((c) => c.type === 'usage');
        servidos.push(u?.type === 'usage' ? (u.upstreamProvider ?? '') : '');
      }
      // A mescla do objeto `provider`: sort E max_price no MESMO corpo.
      const comSort = await chamar({
        priceCeiling: teto,
        routingPreference: 'price',
      });
      expect(comSort.find((c) => c.type === 'error')).toBeUndefined();
      const us = comSort.find((c) => c.type === 'usage');
      servidos.push(us?.type === 'usage' ? (us.upstreamProvider ?? '') : '');

      process.stdout.write(
        `[smoke] modelo=${modelo} teto=${JSON.stringify(teto)} ` +
          `elegiveis=${JSON.stringify([...dentro])} servidos=${JSON.stringify(servidos)} ` +
          `gasto_micros=${gastoMicros}\n`,
      );
      for (const s of servidos) expect(dentro.has(s.toLowerCase())).toBe(true);

      // Controle: US$ 0,001/M não cabe em upstream nenhum. A recusa vem antes
      // de qualquer cobrança.
      const recusada = await chamar({
        priceCeiling: {
          inputPerMillionMicros: 1_000,
          outputPerMillionMicros: 1_000,
        },
      });
      const erro = recusada.find((c) => c.type === 'error');
      process.stdout.write(
        `[smoke] controle=${JSON.stringify(erro)} gasto_micros=${gastoMicros}\n`,
      );
      expect(erro).toMatchObject({ type: 'error', code: 'price_ceiling' });
    }, 300_000);
  },
);
