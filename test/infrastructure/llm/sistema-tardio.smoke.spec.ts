import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatOptions, ChatStreamChunk } from '@brabo/shared';
import type { LLMProvider } from '../../../src/application/ports/llm-provider.port';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';
import { BitdeerProvider } from '../../../src/infrastructure/llm/bitdeer-provider';
import { DeepInfraProvider } from '../../../src/infrastructure/llm/deepinfra-provider';
import { NvidiaNimProvider } from '../../../src/infrastructure/llm/nvidia-nim-provider';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';
import { OpenAIProvider } from '../../../src/infrastructure/llm/openai-provider';
import { OpenRouterProvider } from '../../../src/infrastructure/llm/openrouter-provider';
import { TogetherProvider } from '../../../src/infrastructure/llm/together-provider';
import { VultrProvider } from '../../../src/infrastructure/llm/vultr-provider';

/**
 * Smoke MANUAL: o provider REAL aceita uma mensagem `role: "system"` DEPOIS de
 * `user` e DEPOIS de `tool`? (AT-161, pré-requisito da orientação de idioma
 * efêmera da AT-081.)
 *
 * A suite de contrato já prova ONDE cada adapter põe essa mensagem no corpo
 * (`posicaoDoSistemaTardio` em `llm-provider.contract.ts`) — contra um servidor
 * falso, que aceita qualquer corpo. A pergunta que sobra é do outro lado do
 * fio: algum provider, ou algum upstream de hub, RECUSA esse corpo? Só uma
 * chamada de verdade responde, e é a régua dos ADRs 0041/0042 — sem esta
 * prova, "aceita" não se declara.
 *
 * O que este smoke prova é ACEITE (o turno termina com texto e sem chunk de
 * erro), NUNCA obediência: se o modelo SEGUE a orientação é pergunta de
 * qualidade, medida pela AT-082, não de protocolo.
 *
 * Cada provider roda só quando a credencial dele existe no ambiente — as
 * MESMAS variáveis dos smokes de aceite (`docs/explanation/aceite-providers.md`),
 * mais `ANTHROPIC_TEST_KEY`. O Ollama não tem chave: liga com
 * `OLLAMA_SISTEMA_TARDIO_SMOKE=1` e um daemon alcançável em `OLLAMA_HOST`
 * (modelo em `OLLAMA_TEST_MODEL`, default `qwen2.5-coder:7b`). Gasta uma
 * fração de centavo por provider de nuvem ligado.
 */

interface Alvo {
  nome: string;
  /** O que liga o caso; ausente/vazio = pulado com aviso. */
  gatilho: string | undefined;
  criar: () => LLMProvider;
  opcoes: () => ChatOptions;
}

const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

const nuvem = (
  nome: string,
  chave: string | undefined,
  modelo: string,
  criar: () => LLMProvider,
): Alvo => ({
  nome,
  gatilho: chave,
  criar,
  opcoes: () => ({ model: modelo, apiKey: chave, maxTokens: 64 }),
});

const ALVOS: Alvo[] = [
  {
    nome: 'ollama',
    gatilho:
      process.env.OLLAMA_SISTEMA_TARDIO_SMOKE === '1' ? 'ligado' : undefined,
    criar: () => new OllamaProvider(),
    opcoes: () => ({
      model: process.env.OLLAMA_TEST_MODEL ?? 'qwen2.5-coder:7b',
      host: ollamaHost,
    }),
  },
  nuvem(
    'anthropic',
    process.env.ANTHROPIC_TEST_KEY,
    process.env.ANTHROPIC_TEST_MODEL ?? 'claude-haiku-4-5-20251001',
    () => new AnthropicProvider(),
  ),
  nuvem(
    'openai',
    process.env.OPENAI_TEST_KEY,
    process.env.OPENAI_TEST_MODEL ?? 'gpt-4o-mini',
    () => new OpenAIProvider(),
  ),
  nuvem(
    'openrouter',
    process.env.OPENROUTER_TEST_KEY,
    process.env.OPENROUTER_TEST_MODEL ?? 'openai/gpt-4o-mini',
    () => new OpenRouterProvider(),
  ),
  nuvem(
    'nvidia-nim',
    process.env.NVIDIA_NIM_TEST_KEY,
    process.env.NVIDIA_NIM_TEST_MODEL ?? 'meta/llama-3.2-3b-instruct',
    () => new NvidiaNimProvider(),
  ),
  nuvem(
    'together',
    process.env.TOGETHER_TEST_KEY,
    process.env.TOGETHER_TEST_MODEL ??
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    () => new TogetherProvider(),
  ),
  nuvem(
    'deepinfra',
    process.env.DEEPINFRA_TEST_KEY,
    process.env.DEEPINFRA_TEST_MODEL ?? 'deepseek-ai/DeepSeek-V3',
    () => new DeepInfraProvider(),
  ),
  nuvem(
    'bitdeer',
    process.env.BITDEER_TEST_KEY,
    process.env.BITDEER_TEST_MODEL ?? 'moonshotai/Kimi-K2.5',
    () => new BitdeerProvider(),
  ),
  nuvem(
    'vultr',
    process.env.VULTR_TEST_KEY,
    process.env.VULTR_TEST_MODEL ?? 'kimi-k2-instruct',
    () => new VultrProvider(),
  ),
];

const TARDIO = 'Responda em português do Brasil, em uma frase curta.';

const CONVERSAS: { depoisDe: 'user' | 'tool'; mensagens: ChatMessage[] }[] = [
  {
    depoisDe: 'user',
    mensagens: [
      { role: 'system', content: 'Você é um assistente conciso.' },
      { role: 'user', content: 'Say hello.' },
      { role: 'system', content: TARDIO },
    ],
  },
  {
    // O histórico de uma chamada do laço de ferramentas: o modelo pediu uma
    // ferramenta, o resultado voltou, e a orientação vem DEPOIS dele. Sem
    // `tools` no pedido — o que se testa é a forma da conversa, não a oferta.
    depoisDe: 'tool',
    mensagens: [
      { role: 'system', content: 'Você é um assistente conciso.' },
      { role: 'user', content: 'What does the README say?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_smoke_1',
            name: 'ler_arquivo',
            arguments: { caminho: 'README.md' },
          },
        ],
      },
      {
        role: 'tool',
        content: 'Brabo: an agent-orchestrated engineering platform.',
        toolCallId: 'call_smoke_1',
        name: 'ler_arquivo',
      },
      { role: 'system', content: TARDIO },
    ],
  },
];

for (const alvo of ALVOS) {
  if (!alvo.gatilho) {
    console.warn(
      `[smoke] sistema tardio — ${alvo.nome} PULADO: sem credencial/gatilho ` +
        'no ambiente. Não provado contra o provider real (AT-161). Ver ' +
        'docs/explanation/aceite-providers.md.',
    );
  }

  describe.skipIf(!alvo.gatilho)(
    `${alvo.nome} — system depois de user/tool contra o provider real (manual)`,
    () => {
      for (const conversa of CONVERSAS) {
        it(
          `aceita system DEPOIS de ${conversa.depoisDe}`,
          { timeout: 120_000 },
          async () => {
            const chunks: ChatStreamChunk[] = [];
            for await (const chunk of alvo
              .criar()
              .chat(conversa.mensagens, alvo.opcoes())) {
              chunks.push(chunk);
            }

            const erro = chunks.find((c) => c.type === 'error');
            expect(
              erro,
              `o provider recusou o corpo: ${JSON.stringify(erro)}`,
            ).toBeUndefined();

            const texto = chunks
              .filter((c) => c.type === 'text_delta')
              .map((c) => (c as { text: string }).text)
              .join('');
            // Registrado, não asserido: obediência é da AT-082.
            console.info(
              `[smoke] ${alvo.nome} depois de ${conversa.depoisDe}: ${JSON.stringify(texto)}`,
            );
            expect(texto.length).toBeGreaterThan(0);
          },
        );
      }
    },
  );
}
