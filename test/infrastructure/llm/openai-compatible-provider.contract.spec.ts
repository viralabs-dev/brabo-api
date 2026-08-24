import { describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { openaiConfig } from '../../../src/infrastructure/llm/openai-provider';
import { GptTokenizerEstimator } from '../../../src/infrastructure/tokenization/gpt-tokenizer-estimator';
import { runLLMProviderContract } from '../../contract/llm-provider.contract';
import {
  CATALOGO_ESPERADO,
  EMBEDDING_ESPERADO,
  FERRAMENTA_ESPERADA,
  PEDACOS_DO_TEXTO,
  STATUS_DO_CENARIO,
  USAGE_ESPERADO,
  subirServidorFalso,
  type CenarioLLM,
} from '../../support/llm/fake-llm-server';

/** SSE no formato `/chat/completions` da OpenAI. */
function dialetoOpenAI(cenario: CenarioLLM, res: ServerResponse): void {
  const status = STATUS_DO_CENARIO[cenario];
  if (status) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'falha simulada',
          ...(status === 413 ? { code: 'context_length_exceeded' } : {}),
        },
      }),
    );
    return;
  }

  if (cenario === 'catalogo') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: CATALOGO_ESPERADO.map((id) => ({ id, object: 'model' })),
      }),
    );
    return;
  }

  // `POST /embeddings`: JSON único, não SSE. `data` sai FORA DE ORDEM de
  // propósito — a doc da OpenAI dá `index` como o vínculo com a entrada e não
  // promete ordem, então quem não ordenar devolve o vetor da frase errada
  // (ADR 0075).
  if (cenario === 'embedding' || cenario === 'embedding_incompleto') {
    const linhas = EMBEDDING_ESPERADO.vetores.map((embedding, index) => ({
      object: 'embedding',
      index,
      embedding,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: cenario === 'embedding' ? [...linhas].reverse() : [linhas[0]],
        model: EMBEDDING_ESPERADO.modeloRespondido,
        usage: {
          prompt_tokens: EMBEDDING_ESPERADO.inputTokens,
          total_tokens: EMBEDDING_ESPERADO.inputTokens,
        },
      }),
    );
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream' });

  if (cenario === 'tool_call') {
    // Fatiado como a OpenAI fatia de verdade: id e nome no primeiro frame,
    // `arguments` em pedaços de string nos seguintes.
    const argumentos = JSON.stringify(FERRAMENTA_ESPERADA.arguments);
    escrever(res, {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_123',
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
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: argumentos.slice(0, 5) } },
            ],
          },
        },
      ],
    });
    escrever(res, {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: argumentos.slice(5) } },
            ],
          },
        },
      ],
    });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: PEDACOS_DO_TEXTO[0] } }] })}\n\n`,
  );

  // Frame partido entre dois writes: o buffer precisa costurar.
  const segundo = `data: ${JSON.stringify({
    choices: [{ delta: { content: PEDACOS_DO_TEXTO[1] } }],
  })}\n\n`;
  res.write(segundo.slice(0, 20));
  res.write(segundo.slice(20));

  if (cenario === 'com_usage') {
    escrever(res, {
      choices: [],
      usage: {
        prompt_tokens: USAGE_ESPERADO.inputTokens,
        completion_tokens: USAGE_ESPERADO.outputTokens,
      },
    });
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

function escrever(res: ServerResponse, corpo: unknown): void {
  res.write(`data: ${JSON.stringify(corpo)}\n\n`);
}

runLLMProviderContract('openai-compatible (base)', () => ({
  dialeto: dialetoOpenAI,
  // Usa a configuração DE PRODUÇÃO da OpenAI apontada para o servidor falso —
  // uma cópia escrita no teste passaria verde mesmo se a real divergisse.
  criar: (baseUrl) =>
    new OpenAICompatibleProvider(
      openaiConfig(baseUrl),
      new GptTokenizerEstimator(),
    ),
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'gpt-4o-mini',
}));

/**
 * A MESMA bateria, com a capability de embedding LIGADA (ADR 0075).
 *
 * Nenhum dos oito providers de nuvem declara `embeddings: true` — sem
 * credencial nenhum smoke provou o endpoint deles, e o ADR 0043 custou duas
 * reversões ao vivo para deixar claro que doc não é prova. O que esta segunda
 * passada prova é outra coisa, e é a que falta: que a BASE fala o dialeto
 * `/embeddings` corretamente — ordena por `index`, lê `usage.prompt_tokens`,
 * recusa lote incompleto e normaliza o erro por `code`.
 *
 * É isso que torna barato virar um provider para `true` no dia em que a chave
 * dele existir: a linha do literal muda, e o dialeto já está exercitado.
 */
runLLMProviderContract('openai-compatible (base, embeddings ligado)', () => ({
  dialeto: dialetoOpenAI,
  criar: (baseUrl) => {
    const base = openaiConfig(baseUrl);
    return new OpenAICompatibleProvider(
      { ...base, capabilities: { ...base.capabilities, embeddings: true } },
      new GptTokenizerEstimator(),
    );
  },
  usageFallback: 'estimated',
  timeoutEnv: 'LLM_REQUEST_TIMEOUT_MS',
  temFerramentasNoPedido: (body) => Array.isArray(body.tools),
  modelo: 'gpt-4o-mini',
  modeloDeEmbedding: 'text-embedding-3-small',
}));

describe('OpenAICompatibleProvider — particularidades da base', () => {
  it('sem tokenizer injetado, usage ausente simplesmente não é emitido', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);
    servidor.usar('sem_usage');

    const provider = new OpenAICompatibleProvider(
      openaiConfig(servidor.baseUrl),
    );
    const chunks = [];
    for await (const chunk of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'gpt-4o-mini',
    })) {
      chunks.push(chunk);
    }
    await servidor.fechar();

    expect(chunks.filter((c) => c.type === 'usage')).toHaveLength(0);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });

  it('a flag streamOptionsIncludeUsage decide o que vai no corpo', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);

    const base = openaiConfig(servidor.baseUrl);
    const semUsage = new OpenAICompatibleProvider({
      ...base,
      flags: { ...base.flags, streamOptionsIncludeUsage: false },
    });

    for await (const _ of semUsage.chat([{ role: 'user', content: 'oi' }], {
      model: 'qualquer',
    })) {
      // drena
    }

    expect(servidor.ultimoPedido()).not.toHaveProperty('stream_options');
    await servidor.fechar();
  });

  it('hub: o provider subjacente sai no chunk de usage (Fase 9b)', async () => {
    // Um hub informa quem SERVIU a chamada num frame qualquer do stream, não
    // necessariamente no que traz o usage — por isso a leitura acontece em
    // todos os frames e o último visto vale.
    const servidor = await subirServidorFalso((_cenario, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'oi' } }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } })}\n\n`,
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const base = openaiConfig(servidor.baseUrl);
    const hub = new OpenAICompatibleProvider({
      ...base,
      extrairUpstreamProvider: (frame) =>
        typeof frame.provider === 'string' ? frame.provider : undefined,
    });

    const chunks = [];
    for await (const chunk of hub.chat([{ role: 'user', content: 'oi' }], {
      model: 'qualquer',
    })) {
      chunks.push(chunk);
    }
    await servidor.fechar();

    expect(chunks.find((c) => c.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 3,
      outputTokens: 1,
      estimated: false,
      upstreamProvider: 'DeepInfra',
    });
  });

  it('sem hub configurado, o chunk de usage não ganha campo nenhum', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);
    servidor.usar('com_usage');

    const provider = new OpenAICompatibleProvider(
      openaiConfig(servidor.baseUrl),
    );
    const chunks = [];
    for await (const chunk of provider.chat([{ role: 'user', content: 'oi' }], {
      model: 'gpt-4o-mini',
    })) {
      chunks.push(chunk);
    }
    await servidor.fechar();

    expect(chunks.find((c) => c.type === 'usage')).not.toHaveProperty(
      'upstreamProvider',
    );
  });

  it('embed recusa quando a capability não é declarada, sem tocar a rede', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);
    // `openaiConfig` de PRODUÇÃO: `embeddings: false` até um smoke com
    // credencial provar (ADR 0075).
    const provider = new OpenAICompatibleProvider(
      openaiConfig(servidor.baseUrl),
    );

    await expect(
      provider.embed(['trecho'], { model: 'text-embedding-3-small' }),
    ).rejects.toThrow(/embeddings/);
    // Nada saiu pela rede: a recusa é da capability, não do provider remoto.
    expect(servidor.ultimoPedido()).toBeUndefined();
    await servidor.fechar();
  });

  it('`dimensions` só vai no corpo quando quem chama pediu', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);
    servidor.usar('embedding');
    const base = openaiConfig(servidor.baseUrl);
    const provider = new OpenAICompatibleProvider({
      ...base,
      capabilities: { ...base.capabilities, embeddings: true },
    });

    await provider.embed(EMBEDDING_ESPERADO.entradas, {
      model: 'text-embedding-3-small',
    });
    expect(servidor.ultimoPedido()).not.toHaveProperty('dimensions');

    await provider.embed(EMBEDDING_ESPERADO.entradas, {
      model: 'text-embedding-3-small',
      dimensions: 256,
    });
    expect(servidor.ultimoPedido()).toMatchObject({
      dimensions: 256,
      input: EMBEDDING_ESPERADO.entradas,
    });

    await servidor.fechar();
  });

  it('mensagens de ferramenta viram role tool com tool_call_id', async () => {
    const servidor = await subirServidorFalso(dialetoOpenAI);
    const provider = new OpenAICompatibleProvider(
      openaiConfig(servidor.baseUrl),
    );

    for await (const _ of provider.chat(
      [
        { role: 'user', content: 'leia o readme' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call_1', name: 'ler_arquivo', arguments: { caminho: 'a' } },
          ],
        },
        {
          role: 'tool',
          content: 'conteudo',
          toolCallId: 'call_1',
          name: 'ler_arquivo',
        },
      ],
      { model: 'gpt-4o-mini' },
    )) {
      // drena
    }

    const mensagens = (
      servidor.ultimoPedido() as { messages: Record<string, unknown>[] }
    ).messages;
    await servidor.fechar();

    expect(mensagens[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          // `arguments` vai como STRING no fio, não como objeto.
          function: { name: 'ler_arquivo', arguments: '{"caminho":"a"}' },
        },
      ],
    });
    expect(mensagens[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'conteudo',
    });
  });
});
