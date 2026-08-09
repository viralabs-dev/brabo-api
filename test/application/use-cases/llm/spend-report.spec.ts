import { describe, expect, it } from 'vitest';
import {
  DIAS_MAXIMO,
  DIAS_PADRAO,
  densificarPorDia,
  janelaValida,
  somarTotais,
} from '../../../../src/application/use-cases/llm/spend-report';
import type { SpendBucket } from '../../../../src/application/ports/token-usage-repository.port';

function bucket(chave: string, costMicros: number, chamadas = 1): SpendBucket {
  return {
    chave,
    rotulo: null,
    actorKind: null,
    costMicros,
    inputTokens: 10,
    outputTokens: 5,
    chamadas,
  };
}

describe('densificarPorDia', () => {
  /**
   * O `GROUP BY` só devolve dia que teve chamada. Uma sparkline montada sobre
   * buracos mente sobre o RITMO: três chamadas em três semanas viram três
   * barras coladas, indistinguíveis de três dias seguidos de uso.
   */
  it('preenche com ZERO o dia sem gasto, e termina em hoje', () => {
    const serie = densificarPorDia(
      [bucket('2026-08-07', 500), bucket('2026-08-09', 1_500)],
      4,
      new Date('2026-08-09T18:00:00Z'),
    );

    expect(serie.map((p) => p.dia)).toEqual([
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]);
    expect(serie.map((p) => p.costMicros)).toEqual([0, 500, 0, 1_500]);
  });

  it('janela de um dia devolve um ponto só', () => {
    const serie = densificarPorDia([], 1, new Date('2026-08-09T00:30:00Z'));
    expect(serie).toEqual([{ dia: '2026-08-09', costMicros: 0, chamadas: 0 }]);
  });

  /**
   * O bucket sai do banco já truncado em UTC. Densificar em horário local
   * deslocaria a série inteira para quem está a oeste de Greenwich — o mesmo
   * defeito que o relatório por mês já pagou uma vez.
   */
  it('o eixo é UTC mesmo perto da meia-noite', () => {
    const serie = densificarPorDia(
      [bucket('2026-08-09', 42)],
      2,
      new Date('2026-08-09T02:00:00Z'),
    );
    expect(serie.at(-1)).toEqual({ dia: '2026-08-09', costMicros: 42, chamadas: 1 });
  });
});

describe('somarTotais', () => {
  it('soma custo, tokens e chamadas', () => {
    expect(somarTotais([bucket('a', 100, 2), bucket('b', 50, 3)])).toEqual({
      costMicros: 150,
      inputTokens: 20,
      outputTokens: 10,
      chamadas: 5,
    });
  });

  it('lista vazia é zero, não erro', () => {
    expect(somarTotais([]).costMicros).toBe(0);
  });
});

describe('janelaValida', () => {
  it('sem parâmetro, lixo ou zero caem no padrão', () => {
    expect(janelaValida(undefined)).toBe(DIAS_PADRAO);
    expect(janelaValida('trinta')).toBe(DIAS_PADRAO);
    expect(janelaValida('0')).toBe(DIAS_PADRAO);
  });

  it('trunca no teto — a janela não é convite a varrer a tabela inteira', () => {
    expect(janelaValida('9999')).toBe(DIAS_MAXIMO);
    expect(janelaValida('7')).toBe(7);
  });
});
