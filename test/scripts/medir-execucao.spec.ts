import { describe, expect, it } from 'vitest';
import {
  formatarDuracao,
  formatarUsd,
  sinaisDeCodigo,
  turnosMudos,
} from '../../scripts/medir-execucao';

/**
 * O instrumento de medição da FASE 13b.
 *
 * A lição da Fase 10 é que métrica anotada à mão não é preenchida — então o
 * script é o instrumento, e o instrumento precisa de teste como qualquer
 * código que decide alguma coisa. Aqui só as funções PURAS: a parte que fala
 * com o banco é exercitada pela execução real.
 */

let seq = 0;
function evento(
  type: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 's1',
    seq,
    type,
    actorKind: 'agent',
    actorId,
    payload,
    createdAt: new Date(2026, 7, 4, 12, 0, seq),
  };
}

describe('turnosMudos', () => {
  it('agente que ativa e responde não é mudo', () => {
    const eventos = [
      evento('agent.activated', 'criativo'),
      evento('agent.response', 'criativo', { content: 'olá' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  it('agente que ativa e não escreve NADA é o defeito que se caça', () => {
    const eventos = [
      evento('agent.activated', 'po'),
      evento('session.closed', 'system'),
    ];

    expect(turnosMudos(eventos).map((e) => e.actorId)).toEqual(['po']);
  });

  /**
   * Falhar em voz alta não é o defeito. O que se procura é o agente que some
   * sem deixar nada escrito — não o que reportou erro.
   */
  it('`agent.error` conta como desfecho', () => {
    const eventos = [
      evento('agent.activated', 'arquiteto'),
      evento('agent.error', 'arquiteto', { message: 'provider fora' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  it('handoff também é desfecho — o agente falou pelo ato de passar adiante', () => {
    const eventos = [
      evento('agent.activated', 'criativo'),
      evento('handoff.offered', 'criativo', { to: 'po' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  /**
   * A janela é por ATOR: a resposta de outro agente no meio não salva quem
   * ficou calado. Era o jeito mais fácil de o defeito passar despercebido.
   */
  it('resposta de OUTRO agente não cobre o silêncio deste', () => {
    const eventos = [
      evento('agent.activated', 'po'),
      evento('agent.response', 'criativo', { content: 'eu falei' }),
    ];

    expect(turnosMudos(eventos).map((e) => e.actorId)).toEqual(['po']);
  });

  it('duas ativações do mesmo agente são julgadas separadamente', () => {
    const eventos = [
      evento('agent.activated', 'po'),
      evento('agent.response', 'po', { content: 'primeira' }),
      evento('agent.activated', 'po'),
      evento('session.closed', 'system'),
    ];

    const mudos = turnosMudos(eventos);
    expect(mudos).toHaveLength(1);
    expect(mudos[0].id).toBe(eventos[2].id);
  });
});

describe('sinaisDeCodigo', () => {
  it('acusa bloco de código, import e nome de arquivo', () => {
    const texto = [
      'Que tal assim:',
      '```ts',
      "import { Hono } from 'hono';",
      '```',
      'coloque em src/server.ts',
    ].join('\n');

    expect(sinaisDeCodigo(texto)).toEqual(
      expect.arrayContaining(['bloco de código', 'import/require', 'nome de arquivo']),
    );
  });

  /**
   * O Criativo falando de PRODUTO não pode acender o farol — senão o sinal
   * vira ruído e ninguém olha mais.
   */
  it('conversa de produto não acende nada', () => {
    const texto =
      'O objetivo é que qualquer visitante veja uma saudação. ' +
      'A regra: a resposta precisa ser imediata e não exigir cadastro.';

    expect(sinaisDeCodigo(texto)).toEqual([]);
  });

  it('comando de shell acende', () => {
    expect(sinaisDeCodigo('rode `pnpm install` antes')).toContain(
      'comando de shell',
    );
  });
});

describe('formatação', () => {
  it('duração em segundos, minutos e horas', () => {
    expect(formatarDuracao(12_000)).toBe('12s');
    expect(formatarDuracao(221_000)).toBe('3m41s');
    expect(formatarDuracao(3_720_000)).toBe('1h02m');
  });

  /** Sub-centavo não pode virar `US$ 0,00`: some a diferença que se está medindo. */
  it('gasto abaixo de um centavo não vira zero', () => {
    expect(formatarUsd(0)).toBe('US$ 0,00');
    expect(formatarUsd(1_811)).toBe('< US$ 0,01');
    expect(formatarUsd(1_250_000)).toBe('US$ 1,25');
  });
});
