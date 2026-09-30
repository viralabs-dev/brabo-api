import { describe, it, expect } from 'vitest';
import type { ChatMessage, ToolDef } from '@brabo/shared';
import {
  CORTE_DO_PASSO,
  MODELO_DO_JEV,
  PASSOS_RECENTES,
  PERGUNTA_DO_JEV,
  RESPONDER_SEM_FERRAMENTA,
  lerRespostaDoJev,
  menuP3,
  microUsdDe,
  montarPedidoAoJev,
  precoImplicitoPorMilhao,
  recortarEstado,
  temColisaoDeNome,
} from '../../../src/domain/llm/tool-router';

const tool = (name: string): ToolDef => ({
  name,
  description: `descrição de ${name}`,
  parameters: { type: 'object', properties: { segredo: { type: 'string' } } },
});

describe('montarPedidoAoJev', () => {
  it('`questions` é um OBJETO chaveado pelo id (a lista da nota do épico dava 400) e o modelo é o pin', () => {
    const pedido = montarPedidoAoJev(
      { agente: 'po', pedido: 'p', contexto: 'c', passos_recentes: [] },
      [tool('a'), tool('b')],
    );
    expect(pedido.model).toBe(MODELO_DO_JEV);
    expect(pedido.model).toBe('typesafe/jev-1.13');
    expect(Array.isArray(pedido.questions)).toBe(false);
    const q = pedido.questions[PERGUNTA_DO_JEV];
    expect(q.type).toBe('choice');
    expect(Object.keys(q.criteria)).toEqual([
      'a',
      'b',
      RESPONDER_SEM_FERRAMENTA,
    ]);
    expect(q.criteria.a).toBe('descrição de a');
  });

  it('nunca manda `parameters`: o Jev escolhe, não preenche', () => {
    const pedido = montarPedidoAoJev(
      { agente: 'po', pedido: 'p', contexto: 'c', passos_recentes: [] },
      [tool('a'), tool('b')],
    );
    expect(JSON.stringify(pedido)).not.toContain('segredo');
  });

  it('detecta a colisão com o nome reservado', () => {
    expect(temColisaoDeNome([tool('a'), tool(RESPONDER_SEM_FERRAMENTA)])).toBe(
      true,
    );
    expect(temColisaoDeNome([tool('a'), tool('b')])).toBe(false);
  });
});

describe('lerRespostaDoJev', () => {
  const corpo = (over: Record<string, unknown> = {}) => ({
    model: 'typesafe/jev-1.13-20260917',
    id: 'gen-dec-1',
    answers: {
      [PERGUNTA_DO_JEV]: {
        type: 'choice',
        choice: 'a',
        probabilities: { a: 0.8, b: 0.15, [RESPONDER_SEM_FERRAMENTA]: 0.05 },
        confidence: 0.71,
      },
    },
    usage: { input_tokens: 1236, output_tokens: 0, cost: 0.000051912 },
    ...over,
  });

  it('lê escolha, confiança, probabilidades e o custo REAL', () => {
    const r = lerRespostaDoJev(corpo(), ['a', 'b']);
    expect(r).toMatchObject({
      status: 'ok',
      escolha: 'a',
      confianca: 0.71,
      custoUsd: 0.000051912,
      tokensDeEntrada: 1236,
    });
  });

  it.each([
    ['null', null],
    ['sem answers', { usage: {} }],
    ['answers como lista', { answers: [] }],
    [
      'choice que não é string',
      corpo({ answers: { [PERGUNTA_DO_JEV]: { choice: 3, confidence: 1 } } }),
    ],
    [
      'confiança ausente',
      corpo({ answers: { [PERGUNTA_DO_JEV]: { choice: 'a' } } }),
    ],
  ])('forma inesperada (%s) vira resposta_invalida, nunca exceção', (_n, c) => {
    expect(lerRespostaDoJev(c, ['a', 'b']).status).toBe('resposta_invalida');
  });

  it('escolha fora das opções vira queda nomeada, e ainda carrega o custo (o Jev cobrou)', () => {
    const r = lerRespostaDoJev(
      corpo({
        answers: {
          [PERGUNTA_DO_JEV]: { choice: 'inventada', confidence: 0.9 },
        },
      }),
      ['a', 'b'],
    );
    expect(r.status).toBe('escolha_fora_das_opcoes');
    expect(r.custoUsd).toBe(0.000051912);
  });

  it('`responder_sem_ferramenta` é uma escolha válida', () => {
    const r = lerRespostaDoJev(
      corpo({
        answers: {
          [PERGUNTA_DO_JEV]: {
            choice: RESPONDER_SEM_FERRAMENTA,
            confidence: 0.6,
          },
        },
      }),
      ['a', 'b'],
    );
    expect(r.status).toBe('ok');
  });
});

describe('recortarEstado', () => {
  const chamada = (id: string, name: string, args: object = {}) => ({
    id,
    name,
    arguments: args as Record<string, unknown>,
  });

  it('agente, contexto (começo do system), pedido (última user) e passos da execução corrente', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Você é o dev-api. '.repeat(200) },
      { role: 'user', content: 'antigo' },
      { role: 'assistant', content: '', toolCalls: [chamada('x', 'velha')] },
      { role: 'tool', content: 'r', toolCallId: 'x' },
      { role: 'user', content: 'escreva o arquivo' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [chamada('1', 'read_file', { path: 'a.ts' })],
      },
      { role: 'tool', content: 'conteúdo', toolCallId: '1' },
    ];
    const { estado, anterior } = recortarEstado('dev-api', messages);
    expect(estado.agente).toBe('dev-api');
    expect(estado.pedido).toBe('escreva o arquivo');
    expect(estado.contexto.startsWith('Você é o dev-api.')).toBe(true);
    expect(estado.contexto.length).toBeLessThan(1600);
    // A execução corrente começa na última mensagem do usuário: `velha` fica de fora.
    expect(estado.passos_recentes).toEqual([
      {
        ferramenta: 'read_file',
        argumentos: '{"path":"a.ts"}',
        resultado: 'conteúdo',
      },
    ]);
    expect(anterior).toBe('read_file');
  });

  it('sem chamada anterior: anterior é null; resultado ausente é dito', () => {
    const semPassos = recortarEstado('po', [
      { role: 'system', content: 's' },
      { role: 'user', content: 'oi' },
    ]);
    expect(semPassos.anterior).toBeNull();
    expect(semPassos.estado.passos_recentes).toEqual([]);

    const semResultado = recortarEstado('po', [
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: '', toolCalls: [chamada('1', 'a')] },
    ]);
    expect(semResultado.estado.passos_recentes[0].resultado).toBe(
      '(sem resultado gravado)',
    );
  });

  it('as 6 últimas chamadas, argumento e resultado cortados em 500', () => {
    const messages: ChatMessage[] = [{ role: 'user', content: 'faça' }];
    for (let i = 0; i < 9; i++) {
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [chamada(`c${i}`, `t${i}`, { x: 'y'.repeat(900) })],
      });
      messages.push({
        role: 'tool',
        content: 'z'.repeat(900),
        toolCallId: `c${i}`,
      });
    }
    const { estado, anterior } = recortarEstado('dev-api', messages);
    expect(estado.passos_recentes).toHaveLength(PASSOS_RECENTES);
    expect(estado.passos_recentes[0].ferramenta).toBe('t3');
    expect(estado.passos_recentes[5].ferramenta).toBe('t8');
    expect(anterior).toBe('t8');
    expect(estado.passos_recentes[0].resultado.length).toBeLessThan(
      CORTE_DO_PASSO + 20,
    );
  });
});

describe('menuP3 — a política medida em 2026-09-29', () => {
  const catalogo = ['a', 'b', 'c', 'd'];

  it('{escolha do Jev, ferramenta anterior}, na ordem do catálogo', () => {
    expect(menuP3(catalogo, 'c', 'a')).toEqual(['a', 'c']);
  });

  it('escolha igual à anterior: menu de UMA ferramenta', () => {
    expect(menuP3(catalogo, 'b', 'b')).toEqual(['b']);
  });

  it('o Jev diz `responder_sem_ferramenta`: catálogo INTEIRO (o Jev só restringe)', () => {
    expect(menuP3(catalogo, RESPONDER_SEM_FERRAMENTA, 'a')).toEqual(catalogo);
  });

  it('sem ferramenta anterior: catálogo inteiro', () => {
    expect(menuP3(catalogo, 'c', null)).toEqual(catalogo);
  });

  it('anterior que não está no catálogo do passo é ignorada: catálogo inteiro', () => {
    expect(menuP3(catalogo, 'c', 'velha')).toEqual(catalogo);
  });

  it('nunca vazio', () => {
    expect(menuP3(catalogo, 'fora', 'a').length).toBeGreaterThan(0);
  });
});

describe('custo do Jev', () => {
  it('micro-USD inteiro do usage.cost', () => {
    expect(microUsdDe(0.000051912)).toBe(52);
    expect(microUsdDe(null)).toBe(0);
  });

  it('preço implícito: tokens × preço = custo (RN-044)', () => {
    const custo = microUsdDe(0.000051912);
    const preco = precoImplicitoPorMilhao(custo, 1236);
    expect(Math.round((1236 * preco) / 1_000_000)).toBe(custo);
    expect(precoImplicitoPorMilhao(50, 0)).toBe(0);
  });
});
