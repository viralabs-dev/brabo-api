import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';

/**
 * A PROVA que a capability `routingPreference` do OpenRouter exige antes de
 * virar `true` (ADR 0166, RN-583). Manual, opcional, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o motivo dito, no
 * mesmo molde de `openrouter-provider.smoke.spec.ts`.
 *
 * Usa a config de PRODUÇÃO com a flag ligada à força: é exatamente a pergunta
 * — "se a flag fosse `true`, o hub aceitaria o campo e diria quem serviu?".
 * UMA chamada por critério, com `max_tokens` pequeno: o gasto é uma fração de
 * centavo.
 *
 * `OPENROUTER_TEST_ROUTING_MODEL` escolhe o modelo; o default é o da medição
 * do AT-090, que tem mais de um upstream (Relace e Baidu medidos em
 * 2026-09-14) — um modelo de upstream único devolveria sempre o mesmo, e a
 * prova não distinguiria "o hub respeitou" de "não havia escolha".
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_ROUTING_MODEL ??
  '~deepseek/deepseek-v4-flash-latest';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`routingPreference` do OpenRouter (ADR 0166) foi PULADA, e a ' +
      'capability continua `false` (não provada). Defina OPENROUTER_TEST_KEY ' +
      '(chave real, com algum crédito) para rodá-la; ' +
      'OPENROUTER_TEST_ROUTING_MODEL troca o modelo.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — `provider.sort` contra a API real (ADR 0166, manual)',
  () => {
    const base = openrouterConfig();
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, routingPreference: true },
    });

    it('`sort: throughput` é aceito e o hub diz qual upstream serviu', async () => {
      const chunks: ChatStreamChunk[] = [];
      const inicio = Date.now();
      for await (const chunk of provider.chat(
        [{ role: 'user', content: 'Responda só: ok' }],
        {
          model: modelo,
          apiKey,
          maxTokens: 8,
          routingPreference: 'throughput',
        },
      )) {
        chunks.push(chunk);
      }
      const latenciaMs = Date.now() - inicio;

      const erro = chunks.find((c) => c.type === 'error');
      expect(erro, JSON.stringify(erro)).toBeUndefined();
      const usage = chunks.find((c) => c.type === 'usage');
      expect(usage).toBeDefined();
      const upstream =
        usage?.type === 'usage' ? usage.upstreamProvider : undefined;
      // Registrado na saída de propósito: é o dado que o PR que virar a flag
      // precisa citar.
      console.info(
        `[smoke] sort=throughput modelo=${modelo} upstream=${upstream ?? '(não informado)'} latencia_ms=${latenciaMs}`,
      );
      expect(typeof upstream).toBe('string');
    }, 120_000);
  },
);
