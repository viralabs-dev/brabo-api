import { describe, expect, it } from 'vitest';
import {
  ehDuplicataSemantica,
  LIMIAR_DE_DUPLICATA_SEMANTICA,
  maisParecida,
  similaridadeCosseno,
} from '../../../src/domain/backlog/duplicata-semantica';

describe('similaridadeCosseno (RN-681)', () => {
  it('vetores iguais dão 1, ortogonais 0, opostos -1', () => {
    expect(similaridadeCosseno([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(similaridadeCosseno([1, 0], [0, 1])).toBe(0);
    expect(similaridadeCosseno([1, 0], [-1, 0])).toBe(-1);
  });

  it('é invariante à escala — o tamanho do texto não vira semelhança', () => {
    expect(similaridadeCosseno([1, 1], [10, 10])).toBeCloseTo(1, 10);
  });

  it('vetor nulo não é parecido com nada (0, não NaN)', () => {
    expect(similaridadeCosseno([0, 0], [1, 1])).toBe(0);
  });

  it('dimensões diferentes LANÇAM: vetores de modelos diferentes não se comparam', () => {
    expect(() => similaridadeCosseno([1, 2], [1, 2, 3])).toThrow(
      /dimensões diferentes/,
    );
  });
});

describe('maisParecida', () => {
  it('devolve a existente de maior cosseno', () => {
    const r = maisParecida(
      [1, 0],
      [
        { id: 'a', title: 'A', vetor: [0, 1] },
        { id: 'b', title: 'B', vetor: [1, 0.1] },
      ],
    );
    expect(r?.id).toBe('b');
  });

  it('sem existentes, null', () => {
    expect(maisParecida([1, 0], [])).toBeNull();
  });
});

describe('ehDuplicataSemantica', () => {
  it('o limiar é "a partir de": igual avisa, abaixo não', () => {
    expect(ehDuplicataSemantica(LIMIAR_DE_DUPLICATA_SEMANTICA)).toBe(true);
    expect(ehDuplicataSemantica(LIMIAR_DE_DUPLICATA_SEMANTICA - 0.001)).toBe(
      false,
    );
  });
});
