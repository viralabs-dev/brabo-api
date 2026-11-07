import { describe, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AT-743 (RN-1007): quanta folga o Haiku 5.5 precisa num gate com prompt de
 * ~22 mil tokens e ferramenta de término obrigatória. Manual, pago (~US$ 0,05):
 * sem chave o describe é PULADO. Não asserta valor de modelo, só registra.
 * Chave: `ANTHROPIC_TEST_KEY` ou `ANTHROPIC_API_KEY`.
 */
const apiKey = process.env.ANTHROPIC_TEST_KEY ?? process.env.ANTHROPIC_API_KEY;
const MODELO = 'claude-haiku-5-5';

if (!apiKey) {
  console.warn(
    '[smoke] sem chave da Anthropic — a prova da folga (AT-743) foi PULADA.',
  );
}

// ~22 mil tokens de regras sintéticas (~190 caracteres por regra, ~50 tokens).
const REGRAS = Array.from(
  { length: 440 },
  (_, i) =>
    `Regra R-${i + 1}: o item ${i + 1} do pacote só pode ser aprovado quando o ` +
    `responsável ${i % 17} confirmar o requisito ${i % 23}, o prazo ${i % 11} ` +
    `estiver dentro da janela e nenhuma dependência do módulo ${i % 29} estiver aberta.`,
).join('\n');
const PROMPT =
  `Você é um gate de revisão. Confira as regras abaixo contra o pacote ` +
  `"P-77" (itens 3, 41, 118 e 402) e, ao terminar, OBRIGATORIAMENTE chame a ` +
  `ferramenta concluir_gate com o veredito.\n\n${REGRAS}`;

const FERRAMENTA = {
  name: 'concluir_gate',
  description: 'Encerra o gate com o veredito. Chamada obrigatória.',
  input_schema: {
    type: 'object' as const,
    properties: {
      veredito: { type: 'string', enum: ['aprovado', 'reprovado'] },
      motivo: { type: 'string' },
    },
    required: ['veredito', 'motivo'],
  },
};

const CONFIGS: {
  nome: string;
  maxTokens: number;
  thinking: Anthropic.ThinkingConfigParam;
  outputConfig?: Anthropic.OutputConfig;
}[] = [
  {
    nome: 'adaptive/8192',
    maxTokens: 8192,
    thinking: { type: 'adaptive', display: 'summarized' },
  },
  {
    nome: 'adaptive/16384',
    maxTokens: 16384,
    thinking: { type: 'adaptive', display: 'summarized' },
  },
  {
    nome: 'adaptive+effort:low/8192',
    maxTokens: 8192,
    thinking: { type: 'adaptive', display: 'summarized' },
    outputConfig: { effort: 'low' },
  },
  { nome: 'disabled/4096', maxTokens: 4096, thinking: { type: 'disabled' } },
];

describe.skipIf(!apiKey)(
  'Anthropic — folga do Haiku 5.5 (AT-743, manual)',
  () => {
    const client = new Anthropic({ apiKey });

    it.each(CONFIGS)(
      '$nome: 2 chamadas, registra thinking/saída/stop_reason/ferramenta',
      async ({ nome, maxTokens, thinking, outputConfig }) => {
        for (const n of [1, 2]) {
          const r = await client.messages.create({
            model: MODELO,
            max_tokens: maxTokens,
            thinking,
            ...(outputConfig ? { output_config: outputConfig } : {}),
            tools: [FERRAMENTA],
            messages: [{ role: 'user', content: PROMPT }],
          });
          const usage = r.usage as unknown as {
            input_tokens: number;
            output_tokens: number;
            output_tokens_details?: { thinking_tokens?: number };
          };
          console.log(
            `[smoke] ${nome} #${n}: thinking_tokens=${usage.output_tokens_details?.thinking_tokens ?? 'n/d'} ` +
              `output_tokens=${usage.output_tokens} input_tokens=${usage.input_tokens} ` +
              `stop_reason=${r.stop_reason} ` +
              `ferramenta_chamada=${r.content.some((b) => b.type === 'tool_use' && b.name === FERRAMENTA.name)}`,
          );
        }
      },
      180_000,
    );
  },
);
