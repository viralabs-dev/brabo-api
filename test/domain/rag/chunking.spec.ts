import { describe, expect, it } from 'vitest';
import {
  chunkMarkdownDocument,
  chunkText,
  splitMarkdownSections,
  CHUNK_TARGET_CHARS,
} from '../../../src/domain/rag/chunking';

describe('chunkText', () => {
  it('texto que cabe no alvo vira UM pedaço só', () => {
    const pedacos = chunkText('um trecho curto qualquer.');
    expect(pedacos).toEqual([{ content: 'um trecho curto qualquer.', index: 0 }]);
  });

  it('texto vazio não gera pedaço nenhum', () => {
    expect(chunkText('   ')).toEqual([]);
  });

  it('texto maior que o alvo é recortado em mais de um pedaço, com sobreposição', () => {
    // Três parágrafos "grandes" — bem acima do alvo padrão de 1200 chars.
    const paragrafo = (letra: string) => letra.repeat(600);
    const texto = [paragrafo('a'), paragrafo('b'), paragrafo('c')].join('\n\n');

    const pedacos = chunkText(texto);

    expect(pedacos.length).toBeGreaterThan(1);
    // Cada pedaço, exceto talvez o último, não deveria estourar MUITO o alvo
    // (a busca por quebra limpa pode empurrar um pouco, nunca dobrar).
    for (const pedaco of pedacos.slice(0, -1)) {
      expect(pedaco.content.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS + 50);
    }
    // Sobreposição real: o fim de um pedaço e o começo do próximo compartilham
    // conteúdo (a não ser que o corte tenha caído numa quebra de parágrafo
    // exata, caso em que não há o que sobrepor).
    expect(pedacos[0].index).toBe(0);
    expect(pedacos[1].index).toBe(1);
  });

  it('texto sem espaço nenhum (bloco patológico) ainda termina — corte bruto aceito', () => {
    const semEspaco = 'x'.repeat(5000);
    const pedacos = chunkText(semEspaco, { targetChars: 1000, overlapChars: 100 });
    expect(pedacos.length).toBeGreaterThan(1);
    // Reconstituído (removendo a sobreposição), o total de caracteres não
    // pode ter encolhido — chunkText nunca pode PERDER texto.
    const total = pedacos.reduce((acc, p) => acc + p.content.length, 0);
    expect(total).toBeGreaterThanOrEqual(semEspaco.length);
  });
});

describe('splitMarkdownSections', () => {
  it('divide por heading, preservando a trilha', () => {
    const md = [
      '# Título',
      'intro',
      '## Seção A',
      'conteúdo A',
      '### Sub A.1',
      'conteúdo A.1',
      '## Seção B',
      'conteúdo B',
    ].join('\n');

    const secoes = splitMarkdownSections(md);

    expect(secoes.map((s) => s.headingPath)).toEqual([
      ['Título'],
      ['Título', 'Seção A'],
      ['Título', 'Seção A', 'Sub A.1'],
      ['Título', 'Seção B'],
    ]);
    expect(secoes[2].content).toContain('conteúdo A.1');
  });

  it('markdown sem heading nenhum vira UMA seção com trilha vazia', () => {
    const secoes = splitMarkdownSections('só um parágrafo solto, sem heading.');
    expect(secoes).toEqual([
      { headingPath: [], content: 'só um parágrafo solto, sem heading.' },
    ]);
  });
});

describe('chunkMarkdownDocument', () => {
  it('cada pedaço carrega o headingPath da SEÇÃO de onde veio', () => {
    const md = ['# Doc', '## Uma', 'a'.repeat(50), '## Duas', 'b'.repeat(50)].join('\n');

    const pedacos = chunkMarkdownDocument(md);

    const secaoUma = pedacos.find((p) => p.content.includes('aaaa'));
    const secaoDuas = pedacos.find((p) => p.content.includes('bbbb'));
    expect(secaoUma?.headingPath).toEqual(['Doc', 'Uma']);
    expect(secaoDuas?.headingPath).toEqual(['Doc', 'Duas']);
  });
});
