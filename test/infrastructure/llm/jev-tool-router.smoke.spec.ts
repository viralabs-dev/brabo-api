import { describe, expect, it } from 'vitest';
import { JevToolRouter } from '../../../src/infrastructure/llm/jev-tool-router';
import {
  montarPedidoAoJev,
  microUsdDe,
} from '../../../src/domain/llm/tool-router';

/**
 * Smoke REAL do adaptador do Decisions API (AT-238, ADR 0179). Manual e
 * opcional: sem `OPENROUTER_TEST_KEY` o describe inteiro é PULADO, com o
 * motivo dito, no mesmo molde de `openrouter-provider.roteamento.smoke.spec.ts`.
 * NUNCA roda em CI e nunca imprime a chave.
 *
 * UMA chamada, com um state pequeno: o gasto é uma fração de centavo (a
 * medição de 2026-09-29 pagou ~US$ 0,00005 por passo). O teto declarado do
 * smoke é US$ 0,05 pela soma do `usage.cost`, e o teste o confere.
 *
 * O que ele prova, e o teste de contrato (com resposta gravada) não: que o
 * endpoint alpha AINDA responde na forma que o adaptador lê. Se o alpha mudar,
 * é ESTE teste que fica vermelho — e em produção o turno cai no catálogo
 * inteiro, com `motivoDaQueda` no evento.
 */
const apiKey = process.env.OPENROUTER_TEST_KEY;
const TETO_DO_SMOKE_USD = 0.05;

if (!apiKey) {
  console.warn(
    '[smoke] OPENROUTER_TEST_KEY não definido — o smoke do roteamento de ' +
      'ferramenta pelo Jev (ADR 0179) foi PULADO. Defina ' +
      'OPENROUTER_TEST_KEY (chave real, com algum crédito) para rodá-lo.',
  );
}

describe.skipIf(!apiKey)(
  'Jev — Decisions API contra a API real (ADR 0179, manual)',
  () => {
    it('decide entre duas ferramentas e devolve o custo real', async () => {
      const tools = [
        {
          name: 'read_file',
          description: 'Lê um arquivo do workspace.',
          parameters: {},
        },
        {
          name: 'write_file',
          description: 'Escreve um arquivo no workspace.',
          parameters: {},
        },
      ];
      const pedido = montarPedidoAoJev(
        {
          agente: 'dev-api',
          pedido: 'Crie o arquivo README.md com o título do projeto.',
          contexto: 'Você é um dev agent.',
          passos_recentes: [
            {
              ferramenta: 'read_file',
              argumentos: '{"path":"package.json"}',
              resultado: '{"name":"demo"}',
            },
          ],
        },
        tools,
      );

      const r = await new JevToolRouter().decidir({
        apiKey: apiKey!,
        pedido,
        opcoes: tools.map((t) => t.name),
      });

      expect(r.status, JSON.stringify(r)).toBe('decidido');
      if (r.status !== 'decidido') return;
      expect([
        ...tools.map((t) => t.name),
        'responder_sem_ferramenta',
      ]).toContain(r.resposta.escolha);
      expect(r.resposta.confianca).toBeGreaterThan(0);
      expect(r.resposta.custoUsd).not.toBeNull();
      expect(r.resposta.custoUsd!).toBeLessThan(TETO_DO_SMOKE_USD);
      expect(microUsdDe(r.resposta.custoUsd)).toBeGreaterThan(0);
    });
  },
);
