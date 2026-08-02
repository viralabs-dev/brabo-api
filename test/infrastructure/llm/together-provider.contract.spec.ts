import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import {
  TOGETHER_BASE_URL,
  TogetherProvider,
  parseCatalogoTogether,
  togetherConfig,
} from '../../../src/infrastructure/llm/together-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** Together fala o dialeto OpenAI padrão de SSE — mesma premissa da base. */
function dialetoTogether(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'falha simulada' } }));
    return;
  }

  if (cenario === 'catalogo') {
    // Formato REAL do catálogo da Together: pricing achatado (número, não
    // string) na própria linha — ver `parseCatalogoTogether`.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: CATALOGO_ESPERADO.map((id) => ({
          id,
          display_name: id,
          context_length: 131_072,
          pricing: { input: 0.88, output: 0.88, base: 0, hourly: 0, finetune: 0 },
        })),
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  if (cenario === 'tool_call') {
    const argumentos = JSON.stringify(FERRAMENTA_ESPERADA.arguments);
    escrever(res, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: { name: FERRAMENTA_ESPERADA.name, arguments: '' },
              },
            ],
          },
        },
      ],
    });
    escrever(res, {
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: argumentos } }] },
        },
      ],
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  escrever(res, { choices: [{ delta: { content: PEDACOS_DO_TEXTO[0] } }] });
  escrever(res, { choices: [{ delta: { content: PEDACOS_DO_TEXTO[1] } }] });

  if (cenario === 'com_usage') {
    escrever(res, {
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function escrever(res: ServerResponse, corpo: unknown): void {
  res.write(`data: ${JSON.stringify(corpo)}\n\n`);
}

runLLMProviderContract('together', () => ({
  dialeto: dialetoTogether,
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      togetherConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
}));

describe('TogetherProvider — quirks (Fase 11b)', () => {
  it('declara listModels: true — catálogo com pricing usável, confirmado na doc oficial', () => {
    const provider = new TogetherProvider();
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      listModels: true,
    });
    expect(TOGETHER_BASE_URL).toBe('https://api.together.ai/v1');
  });
});

describe('parseCatalogoTogether', () => {
  it('converte pricing USD/milhão (número) para micro-USD por milhão', () => {
    const catalogo = parseCatalogoTogether({
      data: [
        {
          id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
          display_name: 'Llama 3.3 70B Instruct Turbo',
          context_length: 131_072,
          pricing: { input: 0.88, output: 0.88, base: 0, hourly: 0, finetune: 0 },
        },
      ],
    });

    expect(catalogo).toEqual([
      {
        name: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        displayName: 'Llama 3.3 70B Instruct Turbo',
        contextLength: 131_072,
        inputPricePerMillionMicros: 880_000,
        outputPricePerMillionMicros: 880_000,
      },
    ]);
  });

  it('linha sem pricing/display_name/context: só o essencial, sem inventar campo', () => {
    const catalogo = parseCatalogoTogether({ data: [{ id: 'algum/modelo' }] });
    expect(catalogo).toEqual([{ name: 'algum/modelo' }]);
  });

  it('linha sem id é descartada', () => {
    const catalogo = parseCatalogoTogether({
      data: [{ display_name: 'sem id' }, { id: '' }, { id: 'valido' }],
    });
    expect(catalogo.map((m) => m.name)).toEqual(['valido']);
  });

  it('corpo sem `data` (ou não-array) vira catálogo vazio, não exceção', () => {
    expect(parseCatalogoTogether({})).toEqual([]);
    expect(parseCatalogoTogether({ data: 'não é array' })).toEqual([]);
    expect(parseCatalogoTogether(null)).toEqual([]);
  });

  it('pricing negativo ou não-numérico é ignorado, nunca vira preço negativo gravado', () => {
    const catalogo = parseCatalogoTogether({
      data: [
        { id: 'modelo-1', pricing: { input: -1, output: 'grátis' } },
      ],
    });
    expect(catalogo).toEqual([{ name: 'modelo-1' }]);
  });
});
