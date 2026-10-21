import { describe, expect, it } from 'vitest';
import type { ChatStreamChunk } from '@brabo/shared';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openrouterConfig } from '../../../src/infrastructure/llm/openrouter-provider';

/**
 * A PROVA que a capability `stickySession` do OpenRouter exige antes de virar
 * `true` (ADR 0221, RN-907). Manual, opcional, contra a API real — sem
 * `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o motivo dito.
 *
 * A prova é a DIFERENÇA (régua da RN-583): N chamadas com a MESMA chave de
 * sessão e a 1ª mensagem VARIANDO (o que o hub, sem chave, trataria como
 * conversas novas) pousam num upstream só; o controle, sem chave, nas mesmas
 * condições, pousa em mais de um. `max_tokens` 8: fração de centavo.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const modelo =
  process.env.OPENROUTER_TEST_SESSION_MODEL ?? 'deepseek/deepseek-v4.1-flash';
const N = 6;

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — a prova da capability ' +
      '`stickySession` do OpenRouter (ADR 0221) foi PULADA.',
  );
}

describe.skipIf(!apiKey)(
  'OpenRouter — `session_id` contra a API real (ADR 0221, manual)',
  () => {
    const base = openrouterConfig();
    // Liga a capability à força: a pergunta é "se fosse true, o hub grudaria?".
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, stickySession: true },
    });

    async function upstreams(sessionKey?: string): Promise<string[]> {
      const vistos: string[] = [];
      const rodada = Math.random().toString(36).slice(2, 8);
      for (let i = 0; i < N; i++) {
        const chunks: ChatStreamChunk[] = [];
        for await (const c of provider.chat(
          [
            { role: 'system', content: `Sessão de teste ${rodada}-${i}.` },
            { role: 'user', content: `Responda só: ok ${i}` },
          ],
          {
            model: modelo,
            apiKey,
            maxTokens: 8,
            ...(sessionKey ? { sessionKey } : {}),
          },
        )) {
          chunks.push(c);
        }
        const erro = chunks.find((c) => c.type === 'error');
        expect(erro, JSON.stringify(erro)).toBeUndefined();
        const usage = chunks.find((c) => c.type === 'usage');
        const up = usage?.type === 'usage' ? usage.upstreamProvider : undefined;
        expect(typeof up).toBe('string');
        vistos.push(up as string);
      }
      process.stdout.write(
        `[smoke] chave=${sessionKey ? 'sim' : 'não'} modelo=${modelo} upstreams=${JSON.stringify(vistos)}\n`,
      );
      return vistos;
    }

    it('com a chave: um upstream só; sem ela: mais de um', async () => {
      const comChave = await upstreams(`brabo:smoke-${Date.now()}:dev-teste`);
      const semChave = await upstreams();
      expect(new Set(comChave).size).toBe(1);
      expect(new Set(semChave).size).toBeGreaterThan(1);
    }, 300_000);
  },
);
