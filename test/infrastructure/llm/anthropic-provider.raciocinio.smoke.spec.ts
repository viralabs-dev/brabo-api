import { afterAll, describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, ChatOptions, ChatStreamChunk } from '@brabo/shared';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';
import { precoDoFabricante } from '../../../src/domain/llm/precos-do-fabricante';

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
        [
          {
            role: 'user',
            content:
              'Quanto é 4817 x 3923? Pense passo a passo antes e responda só o número.',
          },
        ],
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
      const usage = chunks.find((c) => c.type === 'usage');
      if (usage?.type === 'usage') somar(modelo, usage);
      console.log(
        `[smoke] ${modelo}: raciocínio ${raciocinio.length} caracteres, resposta ${JSON.stringify(texto.trim())}, ${JSON.stringify(usage)}`,
      );
      // AT-739 (RN-666): o `thinking_tokens` do `message_delta` chega ao metering.
      expect(
        (usage as { reasoningTokens: number }).reasoningTokens,
      ).toBeGreaterThan(0);
      expect(raciocinio.length).toBeGreaterThan(0);
      expect(texto.replace(/\D/g, '')).toContain('18897091');
      expect(texto).not.toContain(raciocinio.slice(0, 40));
    });

    // --- AT-739: raciocínio DESLIGADO por modelo (decisão do dono de 05/11) ---
    const ferramenta = {
      name: 'registrar',
      description: 'Registra um número.',
      parameters: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
      },
    };
    const pedido: ChatMessage[] = [
      {
        role: 'user',
        content: 'Chame a ferramenta registrar com n = 7. Nada mais.',
      },
    ];

    it.each([
      ['claude-haiku-5-5', 'thinking: disabled'],
      ['claude-sonnet-5-5', 'thinking: between_tools'],
      ['claude-opus-5-5', 'output_config.effort: low'],
    ])(
      'reasoningOff em %s (%s): aceito, chama a ferramenta e não trunca',
      async (m) => {
        const chunks = await rodar(pedido, {
          model: m,
          maxTokens: 256,
          // Teto do custo: a folga do que ainda pensa é este orçamento.
          reasoningBudget: 512,
          reasoning: true,
          reasoningOff: true,
          tools: [ferramenta],
        });
        const erro = chunks.find((c) => c.type === 'error');
        expect(erro, JSON.stringify(erro)).toBeUndefined();
        expect(chunks.some((c) => c.type === 'truncated')).toBe(false);
        expect(chunks.some((c) => c.type === 'tool_calls')).toBe(true);
        const usage = chunks.find((c) => c.type === 'usage');
        console.log(`[smoke] ${m} desligado: ${JSON.stringify(usage)}`);
        expect(usage).toBeDefined();
      },
    );

    it('Opus 5.5 recusa `thinking: disabled` com 400 (por isso `effort: low`)', async () => {
      const client = new Anthropic({ apiKey });
      const erro = await client.messages
        .create({
          model: 'claude-opus-5-5',
          max_tokens: 16,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: 'oi' }],
        })
        .then(
          (r) => {
            somar('claude-opus-5-5', {
              inputTokens: r.usage.input_tokens,
              outputTokens: r.usage.output_tokens,
            });
            return undefined;
          },
          (e: unknown) => e,
        );
      console.log(
        `[smoke] claude-opus-5-5 disabled: ${erro instanceof Anthropic.APIError ? `${erro.status} ${erro.message.slice(0, 160)}` : 'ACEITO'}`,
      );
      expect((erro as { status?: number })?.status).toBe(400);
    });

    it('preserved thinking: mudar o `system` com o bloco de raciocínio reenviado', async () => {
      const opcoes: Partial<ChatOptions> = {
        model: 'claude-haiku-5-5',
        maxTokens: 512,
        reasoning: true,
        reasoningBudget: 1024,
        tools: [ferramenta],
      };
      // Conta que obriga a pensar: sem bloco de raciocínio não há o que preservar.
      const pedidoComConta: ChatMessage[] = [
        {
          role: 'user',
          content:
            'Calcule 4817 x 3923 pensando passo a passo e chame a ferramenta registrar com o resultado.',
        },
      ];
      const volta1 = await rodar(
        [{ role: 'system', content: 'Sistema A.' }, ...pedidoComConta],
        opcoes,
      );
      const tc = volta1.find((c) => c.type === 'tool_calls');
      expect(
        tc,
        JSON.stringify(volta1.find((c) => c.type === 'error')),
      ).toBeDefined();
      if (tc?.type !== 'tool_calls') return;
      expect(tc.thinkingBlocks?.length ?? 0).toBeGreaterThan(0);
      const volta2 = await rodar(
        [
          { role: 'system', content: 'Sistema B, diferente do primeiro.' },
          ...pedidoComConta,
          {
            role: 'assistant',
            content: '',
            toolCalls: tc.toolCalls,
            ...(tc.thinkingBlocks ? { thinkingBlocks: tc.thinkingBlocks } : {}),
          },
          ...tc.toolCalls.map((c): ChatMessage => ({
            role: 'tool',
            content: 'ok',
            toolCallId: c.id,
          })),
        ],
        opcoes,
      );
      const erro = volta2.find((c) => c.type === 'error');
      console.log(
        `[smoke] preserved thinking (${tc.thinkingBlocks?.length ?? 0} blocos reenviados, system trocado): ${erro ? JSON.stringify(erro) : 'aceito'}`,
      );
      expect(erro, JSON.stringify(erro)).toBeUndefined();
    });

    async function rodar(
      mensagens: ChatMessage[],
      opcoes: Partial<ChatOptions>,
    ): Promise<ChatStreamChunk[]> {
      const chunks: ChatStreamChunk[] = [];
      for await (const c of provider.chat(mensagens, {
        apiKey,
        ...opcoes,
      } as ChatOptions))
        chunks.push(c);
      const usage = chunks.find((c) => c.type === 'usage');
      if (usage?.type === 'usage') somar(opcoes.model!, usage);
      return chunks;
    }
  },
);

// O custo do smoke, pela tabela do fabricante (teto autorizado: US$ 0,10).
let custoMicros = 0;
function somar(
  modelo: string,
  u: { inputTokens: number; outputTokens: number },
): void {
  const p = precoDoFabricante(modelo);
  if (p)
    custoMicros +=
      (u.inputTokens * p.entradaMicros + u.outputTokens * p.saidaMicros) / 1e6;
}
afterAll(() => {
  if (apiKey)
    console.log(
      `[smoke] custo estimado: US$ ${(custoMicros / 1e6).toFixed(5)}`,
    );
});
