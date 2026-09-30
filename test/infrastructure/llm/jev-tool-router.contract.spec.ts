import { describe, it, expect } from 'vitest';
import { JevToolRouter } from '../../../src/infrastructure/llm/jev-tool-router';
import {
  ENDPOINT_DO_JEV,
  PERGUNTA_DO_JEV,
  montarPedidoAoJev,
} from '../../../src/domain/llm/tool-router';

/**
 * Contrato do adaptador do Decisions API (AT-238, ADR 0179) contra respostas
 * GRAVADAS — sem rede, sem chave, sem gasto. A forma é a medida em
 * 2026-09-29 (`scripts/jev/jev.ts`); os números são de uma linha real da
 * rodada 1 (`confianca 0.71`, `tokensDeEntrada 1236`, `custoUsd 0.000051912`).
 *
 * Este é o teste que torna aceitável depender de um endpoint ALPHA: cada
 * desvio da forma vira uma queda NOMEADA, e o adaptador nunca lança.
 */
const CHAVE = 'sk-or-v1-CHAVE-DE-TESTE-NAO-IMPRIMIR';

const RESPOSTA_GRAVADA = {
  id: 'gen-dec-1790668795-bCeGaa7RnuAh94TNE2fC',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'Typesafe',
  answers: {
    [PERGUNTA_DO_JEV]: {
      type: 'choice',
      choice: 'ask_structured_questions',
      probabilities: {
        ask_structured_questions: 0.71,
        emit_artifact: 0.21,
        responder_sem_ferramenta: 0.08,
      },
      confidence: 0.71,
    },
  },
  usage: { input_tokens: 1236, output_tokens: 0, cost: 0.000051912 },
};

const OPCOES = ['ask_structured_questions', 'emit_artifact'];
const PEDIDO = montarPedidoAoJev(
  { agente: 'criativo', pedido: 'oi', contexto: 'c', passos_recentes: [] },
  OPCOES.map((name) => ({ name, description: name, parameters: {} })),
);

const resposta = (corpo: string, status = 200): Response =>
  new Response(corpo, { status });

/** Um `fetch` de mentira que devolve sempre a mesma resposta gravada. */
const devolve =
  (corpo: string, status = 200): typeof fetch =>
  () =>
    Promise.resolve(resposta(corpo, status));

interface Visto {
  url: string;
  init: RequestInit;
}

describe('JevToolRouter — contrato com a resposta gravada', () => {
  it('caminho feliz: decide, com escolha, confiança, probabilidades e custo real', async () => {
    const vistos: Visto[] = [];
    const router = new JevToolRouter((url, init) => {
      vistos.push({ url: String(url), init: init as RequestInit });
      return Promise.resolve(resposta(JSON.stringify(RESPOSTA_GRAVADA)));
    }, 2000);

    const r = await router.decidir({
      apiKey: CHAVE,
      pedido: PEDIDO,
      opcoes: OPCOES,
    });

    expect(r.status).toBe('decidido');
    if (r.status !== 'decidido') return;
    expect(r.resposta).toMatchObject({
      escolha: 'ask_structured_questions',
      confianca: 0.71,
      custoUsd: 0.000051912,
      tokensDeEntrada: 1236,
    });
    expect(r.resposta.probabilidades.emit_artifact).toBe(0.21);
    expect(r.latenciaMs).toBeGreaterThanOrEqual(0);

    // O pedido que SAI: endpoint alpha, Bearer, `questions` como objeto.
    expect(vistos).toHaveLength(1);
    const visto = vistos[0];
    expect(visto.url).toBe(ENDPOINT_DO_JEV);
    expect(visto.url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(visto.init.method).toBe('POST');
    expect((visto.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${CHAVE}`,
    );
    const corpo = JSON.parse(visto.init.body as string) as {
      model: string;
      questions: Record<string, { type: string }>;
    };
    expect(corpo.model).toBe('typesafe/jev-1.13');
    expect(Array.isArray(corpo.questions)).toBe(false);
    expect(corpo.questions[PERGUNTA_DO_JEV].type).toBe('choice');
  });

  it('a chave nunca aparece no resultado', async () => {
    const router = new JevToolRouter(devolve('boom', 500), 2000);
    const r = await router.decidir({
      apiKey: CHAVE,
      pedido: PEDIDO,
      opcoes: OPCOES,
    });
    expect(JSON.stringify(r)).not.toContain(CHAVE);
  });
});

describe('JevToolRouter — cada desvio vira queda nomeada, nunca exceção', () => {
  const decidirCom = (chamar: typeof fetch, timeoutMs = 2000) =>
    new JevToolRouter(chamar, timeoutMs).decidir({
      apiKey: CHAVE,
      pedido: PEDIDO,
      opcoes: OPCOES,
    });

  it('erro HTTP (inclui o 404/410 de um endpoint alpha que mudou)', async () => {
    for (const status of [400, 404, 410, 429, 500]) {
      const r = await decidirCom(devolve('{"error":"x"}', status));
      expect(r).toMatchObject({ status: 'queda', motivo: 'erro_http' });
      if (r.status === 'queda')
        expect(r.detalhe.startsWith(String(status))).toBe(true);
    }
  });

  it('timeout: o teto próprio aborta a chamada', async () => {
    const lento: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const sinal = (init as RequestInit).signal as AbortSignal;
        sinal.addEventListener('abort', () => {
          reject(sinal.reason as Error);
        });
      });
    const r = await decidirCom(lento, 25);
    expect(r).toMatchObject({ status: 'queda', motivo: 'timeout' });
  });

  it('erro de rede', async () => {
    const r = await decidirCom(() =>
      Promise.reject(new TypeError('fetch failed')),
    );
    expect(r).toMatchObject({ status: 'queda', motivo: 'erro_de_rede' });
  });

  it('JSON inesperado: corpo que nem é JSON', async () => {
    const r = await decidirCom(devolve('<html>bad gateway</html>'));
    expect(r).toMatchObject({ status: 'queda', motivo: 'resposta_invalida' });
  });

  it('JSON inesperado: forma que não é a do Decisions API', async () => {
    const r = await decidirCom(
      devolve(
        JSON.stringify({ answers: [], choice: 'ask_structured_questions' }),
      ),
    );
    expect(r).toMatchObject({ status: 'queda', motivo: 'resposta_invalida' });
  });

  it('escolha fora das opções: queda, e o custo que o Jev cobrou fica registrado', async () => {
    const fora = structuredClone(RESPOSTA_GRAVADA);
    fora.answers[PERGUNTA_DO_JEV].choice = 'ferramenta_inventada';
    const r = await decidirCom(devolve(JSON.stringify(fora)));
    expect(r).toMatchObject({
      status: 'queda',
      motivo: 'escolha_fora_das_opcoes',
      custoUsd: 0.000051912,
    });
  });
});
