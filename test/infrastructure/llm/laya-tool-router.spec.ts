import { afterEach, describe, expect, it } from 'vitest';
import { LayaToolRouter } from '../../../src/infrastructure/llm/laya-tool-router';
import { LayaStatus } from '../../../src/infrastructure/llm/laya-status';
import {
  MODELO_DO_LAYA,
  PERGUNTA_DO_JEV,
  RESPONDER_SEM_FERRAMENTA,
  montarPedidoAoJev,
} from '../../../src/domain/llm/tool-router';

/** O Laya (AT-626, ADR 0290) contra respostas de mentira: sem rede, sem GPU. */
const OPCOES = ['read_file', 'write_file'];
const PEDIDO = montarPedidoAoJev(
  { agente: 'dev-api', pedido: 'oi', contexto: 'c', passos_recentes: [] },
  OPCOES.map((name) => ({ name, description: name, parameters: {} })),
);
const corpo = (choice: string, confidence: number) =>
  JSON.stringify({
    answers: {
      [PERGUNTA_DO_JEV]: {
        type: 'choice',
        choice,
        probabilities: { read_file: confidence, write_file: 1 - confidence },
        confidence,
      },
    },
    usage: { input_tokens: 900, output_tokens: 0 },
  });
const devolve =
  (texto: string, status = 200): typeof fetch =>
  () =>
    Promise.resolve(new Response(texto, { status }));

afterEach(() => {
  delete process.env.TOOL_ROUTER_URL;
  delete process.env.TOOL_ROUTER_API_KEY;
  delete process.env.TOOL_ROUTER_LAYA_LIMIAR;
  delete process.env.TOOL_ROUTER_LAYA_VRAM_MIN_MIB;
});

describe('LayaToolRouter', () => {
  it('uma chamada só, SEM a opção reservada e sem chave quando não há TOOL_ROUTER_API_KEY', async () => {
    process.env.TOOL_ROUTER_URL = 'http://laya:8000/';
    let visto: { url: string; init: RequestInit } | undefined;
    const chamar = (url: string | URL, init?: RequestInit) => {
      visto = { url: String(url), init: init! };
      return Promise.resolve(new Response(corpo('read_file', 0.9)));
    };
    const r = await new LayaToolRouter(chamar).decidir({
      pedido: PEDIDO,
      opcoes: OPCOES,
    });
    expect(visto!.url).toBe('http://laya:8000/v1/systemone');
    expect(visto!.init.headers).not.toHaveProperty('Authorization');
    const enviado = JSON.parse(visto!.init.body as string) as {
      questions: Record<string, { criteria: object }>;
    };
    expect(Object.keys(enviado.questions[PERGUNTA_DO_JEV].criteria)).toEqual(
      OPCOES,
    );
    expect(r).toMatchObject({
      status: 'decidido',
      modelo: MODELO_DO_LAYA,
      resposta: { escolha: 'read_file', custoUsd: null },
    });
  });

  it('TOOL_ROUTER_API_KEY, quando existe, vai como Bearer', async () => {
    process.env.TOOL_ROUTER_URL = 'http://laya:8000';
    process.env.TOOL_ROUTER_API_KEY = 'segredo-de-teste';
    let auth: unknown;
    await new LayaToolRouter((_u: unknown, init?: RequestInit) => {
      auth = (init!.headers as Record<string, string>).Authorization;
      return Promise.resolve(new Response(corpo('read_file', 0.9)));
    }).decidir({ pedido: PEDIDO, opcoes: OPCOES });
    expect(auth).toBe('Bearer segredo-de-teste');
  });

  it('confiança abaixo do limiar vira responder_sem_ferramenta (catálogo inteiro)', async () => {
    process.env.TOOL_ROUTER_URL = 'http://laya:8000';
    process.env.TOOL_ROUTER_LAYA_LIMIAR = '0.8';
    const r = await new LayaToolRouter(
      devolve(corpo('read_file', 0.7)),
    ).decidir({ pedido: PEDIDO, opcoes: OPCOES });
    expect(r).toMatchObject({
      status: 'decidido',
      resposta: { escolha: RESPONDER_SEM_FERRAMENTA },
    });
  });

  it.each([
    ['sem URL configurada', undefined, devolve(''), 'erro_de_rede'],
    ['HTTP 500', 'http://laya:8000', devolve('x', 500), 'erro_http'],
    [
      'corpo que não é JSON',
      'http://laya:8000',
      devolve('<html>'),
      'resposta_invalida',
    ],
    [
      'escolha fora das opções',
      'http://laya:8000',
      devolve(corpo('apagar_tudo', 0.99)),
      'escolha_fora_das_opcoes',
    ],
    [
      'rede caída',
      'http://laya:8000',
      () => Promise.reject(new TypeError('fetch failed')),
      'erro_de_rede',
    ],
    [
      'estouro do teto',
      'http://laya:8000',
      () =>
        Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
      'timeout',
    ],
  ])('%s: queda nomeada, nunca lança', async (_n, url, chamar, motivo) => {
    if (url) process.env.TOOL_ROUTER_URL = url;
    const r = await new LayaToolRouter(chamar).decidir({
      pedido: PEDIDO,
      opcoes: OPCOES,
    });
    expect(r).toMatchObject({
      status: 'queda',
      motivo,
      modelo: MODELO_DO_LAYA,
    });
  });
});

describe('LayaStatus — os cinco estados', () => {
  const saude = (h: object): typeof fetch => devolve(JSON.stringify(h));
  const BOM = { dispositivo: 'cuda', vramLivreMiB: 5600, p95Ms: 251 };

  it.each([
    ['nao_configurado', undefined, devolve('{}'), 'TOOL_ROUTER_URL ausente'],
    [
      'sem_resposta',
      'http://laya:8000',
      () => Promise.reject(new Error('x')),
      'Error',
    ],
    ['sem_resposta', 'http://laya:8000', devolve('x', 503), 'http_503'],
    [
      'sem_gpu',
      'http://laya:8000',
      saude({ dispositivo: 'cpu', vramLivreMiB: null, p95Ms: 3800 }),
      'sem_gpu',
    ],
    [
      'sem_gpu',
      'http://laya:8000',
      saude({ ...BOM, vramLivreMiB: 1500 }),
      'vram_insuficiente',
    ],
    [
      'lento',
      'http://laya:8000',
      saude({ ...BOM, p95Ms: 900 }),
      'p95_acima_do_teto',
    ],
    ['proficiente', 'http://laya:8000', saude(BOM), null],
  ])('%s (%s)', async (estado, url, chamar, motivo) => {
    if (url) process.env.TOOL_ROUTER_URL = url;
    const s = await new LayaStatus(chamar).situacao();
    expect(s).toMatchObject({ estado, motivo });
    expect(Number.isNaN(Date.parse(s.desde))).toBe(false);
  });

  it('cache de 30 s, e `fresco` ignora o cache; `desde` só anda quando o estado muda', async () => {
    process.env.TOOL_ROUTER_URL = 'http://laya:8000';
    let chamadas = 0;
    let h: object = BOM;
    const st = new LayaStatus(() => {
      chamadas++;
      return Promise.resolve(new Response(JSON.stringify(h)));
    });
    const a = await st.situacao();
    await st.situacao();
    expect(chamadas).toBe(1);
    const b = await st.situacao(true);
    expect(chamadas).toBe(2);
    expect(b.desde).toBe(a.desde);
    h = { ...BOM, dispositivo: 'cpu' };
    expect((await st.situacao(true)).estado).toBe('sem_gpu');
  });
});
