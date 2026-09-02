import { describe, expect, it } from 'vitest';
import {
  KS,
  assinaturaDePesos,
  distribuicaoDeRank,
  percentil,
  precisionAtK,
  proporcao,
  type VotoMedido,
} from '../../scripts/medir-rag';

/**
 * Os helpers PUROS de `medir:rag` (RN-479/480) — sem banco, sem Nest. O
 * caminho de I/O do script é exercido rodando o comando; o que cabe em teste é
 * a aritmética, e é ela que decide o que a calibração vai ler.
 */

function voto(
  rank: number,
  verdict: VotoMedido['verdict'] = 'util',
): VotoMedido {
  return { chunkId: `c-${rank}-${verdict}`, verdict, rank };
}

describe('percentil', () => {
  it('caminho feliz: p50/p95 pelo vizinho mais próximo, sem interpolar', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    // ceil(0.5*10)-1 = 4 → 50; ceil(0.95*10)-1 = 9 → 100. Os dois são valores
    // que alguma busca REALMENTE mediu — um p95 interpolado não seria.
    expect(percentil(v, 0.5)).toBe(50);
    expect(percentil(v, 0.95)).toBe(100);
    expect(v).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('CASO DE FALHA: lista vazia é `null`, nunca 0 — não medido não é zero', () => {
    expect(percentil([], 0.5)).toBeNull();
  });
});

describe('precisionAtK', () => {
  it('caminho feliz: o denominador é o que foi JULGADO, nunca `k`', () => {
    // Dois votos em rank ≤ 3 (um útil, um irrelevante) e um útil em rank 7.
    const votos = [voto(1), voto(2, 'irrelevante'), voto(7)];

    const p = precisionAtK(votos, [1, 3, 10]);

    expect(p[0]).toEqual({ k: 1, uteis: 1, julgados: 1, precision: 1 });
    // k=3: 1 útil de 2 julgados. Se o denominador fosse `k` daria 1/3, e a
    // métrica cairia sozinha só porque ninguém votou no terceiro trecho.
    expect(p[1]).toEqual({ k: 3, uteis: 1, julgados: 2, precision: 0.5 });
    expect(p[2]).toEqual({ k: 10, uteis: 2, julgados: 3, precision: 2 / 3 });
  });

  it('CASO DE FALHA: faixa sem nenhum voto é `null`, e não 0 (RN-088)', () => {
    // Só um voto, em rank 5: em k=1 e k=3 ninguém julgou nada.
    const p = precisionAtK([voto(5)], [1, 3, 5]);

    expect(p[0].precision).toBeNull();
    expect(p[1].precision).toBeNull();
    expect(p[2].precision).toBe(1);
  });

  it('a régua padrão são os quatro `k` fixos — mudar entre medições impede comparar', () => {
    expect(KS).toEqual([1, 3, 5, 10]);
    expect(precisionAtK([]).map((p) => p.k)).toEqual([1, 3, 5, 10]);
  });
});

describe('distribuicaoDeRank', () => {
  it('caminho feliz: conta SÓ os úteis, por rank, em ordem crescente', () => {
    const votos = [voto(1), voto(1), voto(7), voto(3, 'irrelevante'), voto(2)];

    expect(distribuicaoDeRank(votos)).toEqual([
      { rank: 1, uteis: 2 },
      { rank: 2, uteis: 1 },
      { rank: 7, uteis: 1 },
    ]);
  });

  it('CASO DE FALHA: só votos irrelevantes produz lista vazia, nunca ranks com zero', () => {
    // Rank com zero seria ruído: a pergunta é ONDE o acerto apareceu, e um
    // rank sem acerto nenhum não é resposta, é ausência de dado.
    expect(
      distribuicaoDeRank([voto(1, 'irrelevante'), voto(4, 'irrelevante')]),
    ).toEqual([]);
  });
});

describe('proporcao', () => {
  it('caminho feliz: contagem E proporção juntas — uma sozinha engana', () => {
    expect(proporcao(12, 40)).toBe('12 de 40 (30,0%)');
  });

  it('CASO DE FALHA: total zero não vira divisão por zero nem "0%"', () => {
    expect(proporcao(0, 0)).toBe('— (nenhuma busca na janela)');
  });
});

describe('assinaturaDePesos', () => {
  it('agrupa buscas pelos pesos CONGELADOS nelas, não pelos de hoje', () => {
    expect(
      assinaturaDePesos({ vector: 0.6, lexical: 0.4, threshold: 0.2 }),
    ).toBe('0,6/0,4 · limiar 0,2');
    expect(
      assinaturaDePesos({ vector: 0.5, lexical: 0.5, threshold: 0.15 }),
    ).toBe('0,5/0,5 · limiar 0,15');
  });
});
