import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk, RoutingPreference } from '@brabo/shared';
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
 * `OPENROUTER_TEST_ROUTING_MODEL` escolhe o modelo. O default é
 * `meta-llama/llama-3.3-70b-instruct` porque é um modelo em que os critérios
 * DISCORDAM: o upstream mais barato não é o mais rápido. O default antigo
 * (`~deepseek/deepseek-v4-flash-latest`, da medição do AT-090) foi medido em
 * 2026-09-29 e devolveu o MESMO upstream (OpenInference) para `price`,
 * `throughput`, `latency` e sem critério — um upstream que lidera tudo não
 * distingue "o hub respeitou" de "não havia escolha", então não prova nada.
 *
 * A prova é a DIFERENÇA: `price` e `throughput` têm de pousar em upstreams
 * distintos. Medido em 2026-09-29: `price` → DeepInfra, `throughput` → Groq,
 * `latency` → Groq numa rodada e CoreWeave na outra, e sem critério o hub
 * alternou Novita/DeepInfra. `latency` não entra na asserção: o líder dele
 * oscila, e a prova não depende disso.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_ROUTING_MODEL ??
  'meta-llama/llama-3.3-70b-instruct';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`routingPreference` do OpenRouter (ADR 0166) foi PULADA. Defina ' +
      'OPENROUTER_TEST_KEY (chave real, com algum crédito) para rodá-la; ' +
      'OPENROUTER_TEST_ROUTING_MODEL troca o modelo.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — `provider.sort` contra a API real (ADR 0166, manual)',
  () => {
    // A config de PRODUÇÃO, sem forçar nada: desde a prova de 2026-09-29 a
    // flag é `true` nela, e é ela que este smoke exercita.
    const provider = new OpenAICompatibleProvider(openrouterConfig());

    async function upstreamCom(
      criterio: RoutingPreference,
    ): Promise<string | undefined> {
      const chunks: ChatStreamChunk[] = [];
      const inicio = Date.now();
      for await (const chunk of provider.chat(
        [{ role: 'user', content: 'Responda só: ok' }],
        {
          model: modelo,
          apiKey,
          maxTokens: 8,
          routingPreference: criterio,
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
      // Registrado na saída de propósito: é o dado que o PR que virou a flag
      // cita.
      console.info(
        `[smoke] sort=${criterio} modelo=${modelo} upstream=${upstream ?? '(não informado)'} latencia_ms=${latenciaMs}`,
      );
      expect(typeof upstream).toBe('string');
      return upstream;
    }

    it('o hub aceita os três critérios, diz quem serviu, e `price` ≠ `throughput`', async () => {
      const porPreco = await upstreamCom('price');
      const porVazao = await upstreamCom('throughput');
      await upstreamCom('latency');
      // O efeito OBSERVÁVEL do critério: se os dois pousassem no mesmo
      // upstream, o campo poderia estar sendo ignorado.
      expect(porPreco).not.toBe(porVazao);
    }, 180_000);
  },
);
