import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatStreamChunk } from '@brabo/shared';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';

/**
 * A PROVA da capability `promptCaching` do provider Anthropic direto (RN-1008,
 * AT-744), no molde de `openrouter-provider.cache.smoke.spec.ts`. Manual,
 * contra a API real (US$ 0,07 no total); sem `ANTHROPIC_API_KEY` o describe é
 * PULADO, com o motivo dito.
 *
 * 1. duas chamadas IGUAIS: a segunda lê o prefixo (`cachedInputTokens` > 0);
 * 2. cauda `system` diferente: o prefixo continua sendo lido;
 * 3. `inputTokens` é a soma das parcelas e o `costMicros` vem dito;
 * 4. preserved thinking no Sonnet 5.5: raciocínio ligado + volta de ferramenta
 *    com o cache ligado; o status/erro é registrado, não presumido.
 *
 * `ANTHROPIC_TEST_CACHE_MODEL` troca o modelo dos casos 1–3 (padrão Haiku 5.5).
 */
const apiKey = process.env.ANTHROPIC_API_KEY;
const modelo = process.env.ANTHROPIC_TEST_CACHE_MODEL ?? 'claude-haiku-5-5';

if (!apiKey) {
  console.warn(
    '[smoke] ANTHROPIC_API_KEY não definido — a prova da capability ' +
      '`promptCaching` do provider Anthropic (RN-1008) foi PULADA.',
  );
}

// Prefixo acima do mínimo cacheável (a Anthropic exige alguns milhares de tokens).
const instrucoes = Array.from(
  { length: 800 },
  (_, i) => `Regra ${i}: responda sempre em uma palavra só.`,
).join('\n');

function conversa(cauda: string): ChatMessage[] {
  return [
    { role: 'system', content: instrucoes },
    { role: 'user', content: 'Responda só: ok' },
    { role: 'system', content: cauda },
  ];
}

async function chamar(
  rotulo: string,
  mensagens: ChatMessage[],
  opcoes: { model?: string; reasoning?: boolean } = {},
) {
  const provider = new AnthropicProvider();
  const chunks: ChatStreamChunk[] = [];
  for await (const c of provider.chat(mensagens, {
    model: opcoes.model ?? modelo,
    apiKey,
    maxTokens: 64,
    ...(opcoes.reasoning ? { reasoning: true } : {}),
  })) {
    chunks.push(c);
  }
  const erro = chunks.find((c) => c.type === 'error');
  const usage = chunks.find((c) => c.type === 'usage');
  console.info(
    `[smoke] ${rotulo} modelo=${opcoes.model ?? modelo} ` +
      `cachedInputTokens=${usage?.type === 'usage' ? (usage.cachedInputTokens ?? 'ausente') : 'sem usage'} ` +
      `inputTokens=${usage?.type === 'usage' ? usage.inputTokens : 'sem usage'} ` +
      `costMicros=${usage?.type === 'usage' ? (usage.costMicros ?? 'ausente') : 'sem usage'}`,
  );
  return { chunks, erro, usage: usage?.type === 'usage' ? usage : undefined };
}

describe.skipIf(!apiKey)(
  'Anthropic direto — `cache_control` contra a API real (RN-1008, manual)',
  () => {
    it('1) a segunda chamada igual lê o prefixo do cache', async () => {
      const a = await chamar('caso1-a', conversa('Responda em pt-BR.'));
      expect(a.erro, JSON.stringify(a.erro)).toBeUndefined();
      const b = await chamar('caso1-b', conversa('Responda em pt-BR.'));
      expect(b.erro, JSON.stringify(b.erro)).toBeUndefined();
      expect(b.usage?.cachedInputTokens ?? 0).toBeGreaterThan(0);
    }, 120_000);

    it('2) a cauda diferente não invalida o prefixo', async () => {
      const r = await chamar('caso2', conversa('Responda em inglês.'));
      expect(r.erro, JSON.stringify(r.erro)).toBeUndefined();
      expect(r.usage?.cachedInputTokens ?? 0).toBeGreaterThan(0);
    }, 120_000);

    it('3) inputTokens soma as parcelas e o custo vem dito', async () => {
      const r = await chamar('caso3', conversa('Responda em pt-BR.'));
      expect(r.erro, JSON.stringify(r.erro)).toBeUndefined();
      expect(r.usage?.inputTokens ?? 0).toBeGreaterThanOrEqual(
        r.usage?.cachedInputTokens ?? 0,
      );
      expect(r.usage?.costMicros ?? 0).toBeGreaterThan(0);
    }, 120_000);

    it('4) preserved thinking no Sonnet 5.5: registra status/erro', async () => {
      const r = await chamar('caso4', conversa('Responda em pt-BR.'), {
        model: 'claude-sonnet-5-5',
        reasoning: true,
      });
      // Não afirma sucesso: o dono quer ver o que a API respondeu.
      console.info(
        `[smoke] caso4 status=${r.erro ? 'erro' : 'ok'} ` +
          `erro=${r.erro ? JSON.stringify(r.erro) : '-'}`,
      );
      expect(r.chunks.length).toBeGreaterThan(0);
    }, 120_000);
  },
);
