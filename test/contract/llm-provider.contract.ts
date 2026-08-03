import { afterEach, describe, expect, it } from 'vitest';
import type { ChatOptions, ChatStreamChunk, LLMErrorCode } from '@brabo/shared';
import type { LLMProvider } from '../../src/application/ports/llm-provider.port';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  TEXTO_ESPERADO,
  USAGE_ESPERADO,
  subirServidorFalso,
  type CenarioLLM,
  type Dialeto,
  type ServidorFalso,
} from '../support/llm/fake-llm-server';

/**
 * Suite de CONTRATO única dos providers de LLM (Fase 9a — ver CLAUDE.md e
 * docs/adr/0041). Espelha o que `git-provider.contract.ts` faz desde a Fase 2:
 * a MESMA bateria roda contra qualquer implementação de `LLMProvider`, e um
 * provider novo (Fase 9b) só precisa escrever o harness.
 *
 * A divisão de responsabilidade é o ponto: **o contrato é dono das asserções,
 * o harness é dono do DIALETO**. Ollama fala NDJSON, a base compatível fala SSE
 * no formato da OpenAI, o Anthropic fala SSE com eventos nomeados — mas os três
 * precisam emitir os mesmos `ChatStreamChunk` para as mesmas situações.
 */
export interface LLMProviderContractHarness {
  /** Traduz cada cenário para o formato de fio deste provider. */
  dialeto: Dialeto;
  /** Constrói o provider já apontado para o endereço dado. */
  criar: (baseUrl: string) => LLMProvider;
  /**
   * Opções extras de `chat()` — o Ollama recebe o endereço por aqui
   * (`options.host`) em vez de pelo construtor.
   */
  chatOptions?: (baseUrl: string) => Partial<ChatOptions>;
  /**
   * O que este provider faz quando a resposta NÃO traz contagem de tokens.
   * As três respostas são divergências REAIS de dialeto, normalizadas aqui em
   * vez de escondidas (ver docs/reference/llm-providers.md):
   *
   * - `estimated`: conta localmente e marca `estimated: true` (base compatível);
   * - `nenhum`: não emite `usage` nenhum (Ollama — sem a linha `done` não há
   *   o que reportar);
   * - `sempre`: o dialeto NÃO SABE omitir contagem, então ela vem de qualquer
   *   jeito com `estimated: false` (Anthropic — `usage` é obrigatório no
   *   `message_start`, e um cenário "sem usage" ali seria protocolo inválido).
   */
  usageFallback: 'estimated' | 'nenhum' | 'sempre';
  /** Env var que regula o teto de INATIVIDADE deste provider. */
  timeoutEnv: string;
  /**
   * Env var que aponta o provider para o servidor, quando `listModels` não
   * recebe o endereço.
   *
   * Só o Ollama precisa: `chat` aceita `options.host`, mas o contrato de
   * `listModels(apiKey?)` não tem por onde passar host — e para um daemon que
   * é um por máquina, ambiente é o lugar certo. Ausente = o provider já foi
   * construído apontado (é o caso de todos os outros).
   */
  hostEnv?: string;
  /** Confirma que as ferramentas oferecidas chegaram no corpo do pedido. */
  temFerramentasNoPedido: (body: Record<string, unknown>) => boolean;
  modelo: string;
}

const FERRAMENTAS = [
  {
    name: FERRAMENTA_ESPERADA.name,
    description: 'Lê um arquivo do repositório',
    parameters: {
      type: 'object',
      properties: { caminho: { type: 'string' } },
      required: ['caminho'],
    },
  },
];

/** Endereço morto: serve para instanciar o provider sem subir servidor. */
const SEM_SERVIDOR = 'http://127.0.0.1:1';

export function runLLMProviderContract(
  label: string,
  makeHarness: () => LLMProviderContractHarness,
) {
  const harness = makeHarness();
  const capabilities = harness.criar(SEM_SERVIDOR).capabilities;

  describe(`LLMProviderContract — ${label}`, () => {
    let servidor: ServidorFalso | undefined;

    afterEach(async () => {
      if (servidor) {
        await servidor.fechar();
        servidor = undefined;
      }
      delete process.env[harness.timeoutEnv];
      if (harness.hostEnv) delete process.env[harness.hostEnv];
    });

    async function rodar(
      cenario: CenarioLLM,
      opcoes: Partial<ChatOptions> = {},
    ): Promise<ChatStreamChunk[]> {
      servidor = await subirServidorFalso(harness.dialeto);
      servidor.usar(cenario);

      const provider = harness.criar(servidor.baseUrl);
      const chunks: ChatStreamChunk[] = [];

      for await (const chunk of provider.chat(
        [{ role: 'user', content: 'oi' }],
        {
          model: harness.modelo,
          apiKey: 'chave-de-teste',
          ...harness.chatOptions?.(servidor.baseUrl),
          ...opcoes,
        },
      )) {
        chunks.push(chunk);
      }
      return chunks;
    }

    function textoDe(chunks: ChatStreamChunk[]): string {
      return chunks
        .filter((c) => c.type === 'text_delta')
        .map((c) => (c as { text: string }).text)
        .join('');
    }

    function erroDe(chunks: ChatStreamChunk[]) {
      const erro = chunks.find((c) => c.type === 'error');
      expect(
        erro,
        `esperava um chunk de erro, veio: ${JSON.stringify(chunks)}`,
      ).toBeDefined();
      return erro as { type: 'error'; code: LLMErrorCode; message: string };
    }

    it('declara capabilities', () => {
      expect(capabilities.streaming).toBe(true);
      expect(typeof capabilities.toolCalling).toBe('boolean');
      expect(typeof capabilities.listModels).toBe('boolean');
    });

    it('stream: remonta o texto mesmo com o frame partido entre dois writes', async () => {
      const chunks = await rodar('stream_ok');

      expect(textoDe(chunks)).toBe(TEXTO_ESPERADO);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
    });

    it('usage informado pelo provider vem com estimated: false', async () => {
      const chunks = await rodar('com_usage');

      expect(chunks.at(-1)).toEqual({
        type: 'usage',
        inputTokens: USAGE_ESPERADO.inputTokens,
        outputTokens: USAGE_ESPERADO.outputTokens,
        estimated: false,
      });
    });

    it('usage ausente: cai no tokenizer local marcado estimated, ou não emite', async () => {
      const chunks = await rodar('sem_usage');
      const usage = chunks.filter((c) => c.type === 'usage');

      // O texto continua chegando inteiro — a falta de contagem não pode
      // custar a resposta.
      expect(textoDe(chunks)).toBe(TEXTO_ESPERADO);

      if (harness.usageFallback === 'estimated') {
        expect(usage).toHaveLength(1);
        expect(usage[0]).toMatchObject({ estimated: true });
        // Estimativa zerada não serviria para cobrar nada.
        expect(
          (usage[0] as { outputTokens: number }).outputTokens,
        ).toBeGreaterThan(0);
      } else if (harness.usageFallback === 'sempre') {
        expect(usage).toHaveLength(1);
        expect(usage[0]).toMatchObject({ estimated: false });
      } else {
        expect(usage).toHaveLength(0);
      }
    });

    it('tool calling: respeita capabilities.toolCalling', async () => {
      if (!capabilities.toolCalling) {
        // Provider chat-only: oferecer ferramentas não pode DERRUBAR o turno —
        // o texto continua chegando (mesma degradação por capability que o
        // contrato de git aplica em `capabilities.pullRequests`).
        const chunks = await rodar('stream_ok', { tools: FERRAMENTAS });
        expect(textoDe(chunks)).toBe(TEXTO_ESPERADO);
        expect(chunks.some((c) => c.type === 'tool_calls')).toBe(false);
        return;
      }

      const chunks = await rodar('tool_call', { tools: FERRAMENTAS });

      // A regressão que isto pega: até a Fase 9a o OpenAIProvider descartava
      // `options.tools` em silêncio e ninguém percebia.
      expect(
        harness.temFerramentasNoPedido(servidor!.ultimoPedido() ?? {}),
        'as ferramentas não chegaram no corpo do pedido',
      ).toBe(true);

      const toolCalls = chunks.find((c) => c.type === 'tool_calls');
      expect(toolCalls).toBeDefined();

      const chamadas = (
        toolCalls as unknown as {
          toolCalls: { id: string; name: string; arguments: unknown }[];
        }
      ).toolCalls;

      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].name).toBe(FERRAMENTA_ESPERADA.name);
      // Desserializado: o ToolLoop recebe objeto, nunca a string do fio.
      expect(chamadas[0].arguments).toEqual(FERRAMENTA_ESPERADA.arguments);
      expect(chamadas[0].id).toBeTruthy();
    });

    const ERROS: { cenario: CenarioLLM; code: LLMErrorCode }[] = [
      { cenario: 'erro_401', code: 'auth' },
      { cenario: 'erro_404', code: 'model_not_found' },
      { cenario: 'erro_429', code: 'rate_limit' },
      { cenario: 'erro_413', code: 'context_length' },
    ];

    for (const { cenario, code } of ERROS) {
      it(`${cenario} vira chunk de erro com code "${code}", não exceção`, async () => {
        expect(erroDe(await rodar(cenario)).code).toBe(code);
      });
    }

    it('catálogo: respeita capabilities.listModels', async () => {
      if (!capabilities.listModels) {
        // Quem não declara a capability não promete o método. O que o contrato
        // exige é que os dois lados andem juntos: ou não existe método, ou
        // chamá-lo REJEITA — nunca uma lista vazia, que o sync leria como
        // "sumiram todos" e indisponibilizaria o catálogo inteiro (RN-043).
        servidor = await subirServidorFalso(harness.dialeto);
        const provider = harness.criar(servidor.baseUrl);
        if (provider.listModels) {
          await expect(provider.listModels('chave-de-teste')).rejects.toThrow();
        }
        return;
      }

      servidor = await subirServidorFalso(harness.dialeto);
      servidor.usar('catalogo');
      if (harness.hostEnv) process.env[harness.hostEnv] = servidor.baseUrl;

      const provider = harness.criar(servidor.baseUrl);
      const catalogo = await provider.listModels!('chave-de-teste');

      expect(catalogo.map((m) => m.name)).toEqual([...CATALOGO_ESPERADO]);
    });

    it('catálogo: erro do provider LANÇA, em vez de virar lista vazia', async () => {
      if (!capabilities.listModels) return;

      servidor = await subirServidorFalso(harness.dialeto);
      servidor.usar('erro_401');
      if (harness.hostEnv) process.env[harness.hostEnv] = servidor.baseUrl;

      const provider = harness.criar(servidor.baseUrl);
      await expect(
        provider.listModels!('chave-invalida'),
      ).rejects.toMatchObject({ code: 'auth' });
    });

    it('servidor mudo: estoura o teto de inatividade em vez de pendurar', async () => {
      // O caso real do ADR 0020: o provider aceitou a conexão e não mandou nem
      // os headers. Antes disto o `fetch` desistia aos 300s fixos do undici
      // com um opaco "fetch failed".
      process.env[harness.timeoutEnv] = '200';

      expect(erroDe(await rodar('mudo')).code).toBe('timeout');
    });
  });
}
