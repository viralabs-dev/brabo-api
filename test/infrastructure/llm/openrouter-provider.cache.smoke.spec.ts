import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';

/**
 * A PROVA que a capability `promptCaching` do OpenRouter exige antes de virar
 * `true` (RN-892, ADRs 0041/0042). Manual, opcional, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o motivo dito, no
 * molde de `openrouter-provider.roteamento.smoke.spec.ts`.
 *
 * Usa a config de PRODUÇÃO com a flag ligada à força: "se a flag fosse
 * `true`, o hub leria o prefixo do cache?". Duas chamadas IGUAIS em sequência
 * (TTL de 5 min), com um prefixo acima do mínimo cacheável da Anthropic
 * (~2 048 tokens no Haiku): a segunda tem de voltar com `cachedInputTokens`
 * > 0. `OPENROUTER_TEST_CACHE_MODEL` troca o modelo.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_CACHE_MODEL ?? 'anthropic/claude-haiku-5.5';

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`promptCaching` do OpenRouter (RN-892) foi PULADA.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — `cache_control` contra a API real (RN-892, manual)',
  () => {
    const base = openrouterConfig();
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, promptCaching: true },
    });

    const instrucoes = Array.from(
      { length: 400 },
      (_, i) => `Regra ${i}: responda sempre em uma palavra só.`,
    ).join('\n');
    const mensagens: ChatMessage[] = [
      { role: 'system', content: instrucoes },
      { role: 'user', content: 'Responda só: ok' },
      { role: 'system', content: 'Responda em pt-BR.' },
    ];

    async function cacheada(): Promise<number> {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(mensagens, {
        model: modelo,
        apiKey,
        maxTokens: 8,
      })) {
        chunks.push(c);
      }
      const erro = chunks.find((c) => c.type === 'error');
      expect(erro, JSON.stringify(erro)).toBeUndefined();
      const usage = chunks.find((c) => c.type === 'usage');
      const lidos =
        usage?.type === 'usage' ? (usage.cachedInputTokens ?? 0) : 0;
      console.info(`[smoke] modelo=${modelo} cached_input_tokens=${lidos}`);
      return lidos;
    }

    it('a segunda chamada igual lê o prefixo do cache', async () => {
      await cacheada();
      expect(await cacheada()).toBeGreaterThan(0);
    }, 120_000);
  },
);
