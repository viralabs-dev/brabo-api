import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/validacao-gates';
import { acharRegistro } from '../../src/infrastructure/gates/gate-registry.loader';

/**
 * Os helpers puros do medidor de gates. A parte que fala com o banco é
 * exercitada rodando o script — mesmo recorte de `medir-execucao.spec.ts`.
 */

describe('parseArgs', () => {
  it('sem argumento nenhum: relatório completo, com banco', () => {
    expect(parseArgs([])).toEqual({ projeto: null, semBanco: false });
  });

  it('`--projeto` captura o uuid seguinte', () => {
    expect(parseArgs(['--projeto', 'abc-123'])).toEqual({
      projeto: 'abc-123',
      semBanco: false,
    });
  });

  /**
   * `pnpm <script> -- --flag` repassa o `--` literal, e é assim que os scripts
   * irmãos são invocados no repositório. Recusá-lo seria recusar o uso normal —
   * foi o primeiro jeito de rodar este script, e falhou.
   */
  it('o `--` do pnpm é ignorado', () => {
    expect(parseArgs(['--', '--sem-banco'])).toEqual({
      projeto: null,
      semBanco: true,
    });
  });

  it('`--projeto` sem valor é uso inválido', () => {
    expect(parseArgs(['--projeto'])).toEqual({
      erro: '--projeto exige um uuid',
    });
    expect(parseArgs(['--projeto', '--sem-banco'])).toEqual({
      erro: '--projeto exige um uuid',
    });
  });

  it('opção desconhecida é uso inválido, não silêncio', () => {
    expect(parseArgs(['--turbo'])).toEqual({
      erro: 'opção desconhecida: --turbo',
    });
  });
});

describe('acharRegistro', () => {
  it('sobe até achar docs/gates.yml', () => {
    // Do diretório deste teste, a raiz do repo está quatro níveis acima.
    expect(acharRegistro(__dirname)).toMatch(/docs\/gates\.yml$/);
  });

  it('devolve null quando não existe em lugar nenhum acima', () => {
    expect(acharRegistro('/tmp', () => false)).toBeNull();
  });

  it('para na raiz do filesystem em vez de girar para sempre', () => {
    let visitas = 0;
    acharRegistro('/a/b/c', () => {
      visitas += 1;
      return false;
    });
    // Quatro níveis (/a/b/c, /a/b, /a, /) e para: sem laço infinito.
    expect(visitas).toBeLessThanOrEqual(5);
  });
});
