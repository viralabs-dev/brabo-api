import { describe, expect, it } from 'vitest';
import {
  acertouCaminhoEsperado,
  rankDoCaminhoEsperado,
  GOLDEN_SET_RAG_TOP_K,
  type GoldenSetHit,
} from '../../../src/domain/rag/golden-set-criterio';
import type { ChunkOrigin } from '../../../src/domain/rag/rag-citation';

function hitDeArquivo(sourcePath: string): GoldenSetHit {
  const origin: ChunkOrigin = { kind: 'file', sourcePath };
  return { origin };
}

function hitDeSessao(sessionId: string): GoldenSetHit {
  const origin: ChunkOrigin = { kind: 'session', sessionId };
  return { origin };
}

describe('acertouCaminhoEsperado', () => {
  it('bate quando o caminho esperado é o primeiro hit', () => {
    const hits = [
      hitDeArquivo('docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md'),
    ];
    expect(
      acertouCaminhoEsperado(
        hits,
        'docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md',
      ),
    ).toBe(true);
  });

  it('bate quando o caminho esperado está em posição intermediária, dentro do topK', () => {
    const hits = [
      hitDeArquivo('docs/architecture.md'),
      hitDeArquivo('docs/glossary.md'),
      hitDeArquivo('docs/adr/0127-tetos-de-rebaixamento-em-project-members.md'),
    ];
    expect(
      acertouCaminhoEsperado(
        hits,
        'docs/adr/0127-tetos-de-rebaixamento-em-project-members.md',
      ),
    ).toBe(true);
  });

  it('NÃO bate quando o caminho esperado só aparece FORA do topK', () => {
    const hits = [
      hitDeArquivo('docs/architecture.md'),
      hitDeArquivo('docs/glossary.md'),
      hitDeArquivo('docs/business-rules.md'),
      hitDeArquivo('docs/explanation/gates.md'),
      hitDeArquivo('docs/explanation/backlog.md'),
      hitDeArquivo('docs/adr/0127-tetos-de-rebaixamento-em-project-members.md'), // rank 6, fora do top-5
    ];
    expect(hits).toHaveLength(6);
    expect(
      acertouCaminhoEsperado(
        hits,
        'docs/adr/0127-tetos-de-rebaixamento-em-project-members.md',
      ),
    ).toBe(false);
  });

  it('NÃO bate quando o caminho não aparece em hit nenhum', () => {
    const hits = [hitDeArquivo('docs/architecture.md')];
    expect(
      acertouCaminhoEsperado(hits, 'docs/adr/0130-broker-de-container.md'),
    ).toBe(false);
  });

  it('NÃO bate por PREFIXO — dois ADRs numerados em sequência não se confundem', () => {
    const hits = [
      hitDeArquivo('docs/adr/0127-tetos-de-rebaixamento-em-project-members.md'),
    ];
    expect(acertouCaminhoEsperado(hits, 'docs/adr/0127')).toBe(false);
  });

  it('hit de sessão nunca conta como acerto — golden-set só espera arquivo', () => {
    const hits = [hitDeSessao('11111111-1111-1111-1111-111111111111')];
    expect(acertouCaminhoEsperado(hits, 'docs/business-rules.md')).toBe(false);
  });

  it('usa GOLDEN_SET_RAG_TOP_K (5) como default quando topK não é passado', () => {
    const hits = Array.from({ length: 6 }, (_, i) =>
      hitDeArquivo(`docs/f${i}.md`),
    );
    // 'docs/f5.md' está na posição 6 (índice 5) — fora do top-5 default.
    expect(acertouCaminhoEsperado(hits, 'docs/f5.md')).toBe(false);
    expect(GOLDEN_SET_RAG_TOP_K).toBe(5);
  });
});

describe('rankDoCaminhoEsperado', () => {
  it('devolve a posição 1-based da primeira ocorrência', () => {
    const hits = [
      hitDeArquivo('docs/architecture.md'),
      hitDeArquivo('docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md'),
    ];
    expect(
      rankDoCaminhoEsperado(
        hits,
        'docs/adr/0080-busca-hibrida-pesos-limiar-e-citacao.md',
      ),
    ).toBe(2);
  });

  it('devolve null quando o caminho não aparece em nenhum hit', () => {
    const hits = [hitDeArquivo('docs/architecture.md')];
    expect(rankDoCaminhoEsperado(hits, 'docs/glossary.md')).toBeNull();
  });

  it('não tem teto — devolve o rank mesmo fora do topK usado por acertouCaminhoEsperado', () => {
    const hits = Array.from({ length: 8 }, (_, i) =>
      hitDeArquivo(`docs/f${i}.md`),
    );
    expect(rankDoCaminhoEsperado(hits, 'docs/f7.md')).toBe(8);
  });
});
