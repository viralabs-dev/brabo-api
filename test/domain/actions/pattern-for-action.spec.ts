import { describe, it, expect } from 'vitest';
import {
  patternsForAction,
  unidadeDoSegmento,
} from '../../../src/domain/actions/pattern-for-action';
import {
  matchesPattern,
  parseCommand,
} from '../../../src/domain/actions/command-matcher';

/**
 * A unidade do "Sempre permitir" (RN-675, AT-257/AT-170, decisão do dono de
 * 01/10): VERBO + SUBCOMANDO, um padrão por SEGMENTO do comando composto.
 */
const terminal = (command: string) =>
  patternsForAction('terminal', { command });

describe('patternsForAction — verbo + subcomando, por segmento (RN-675)', () => {
  it.each([
    ['npm test', ['Terminal(npm test)']],
    ['npm test -- --watch', ['Terminal(npm test)']],
    ['git status --short', ['Terminal(git status)']],
    ['mix test test/engine/x_test.exs', ['Terminal(mix test)']],
    ['npx vitest run src', ['Terminal(npx vitest)']],
    ['ls', ['Terminal(ls)']],
  ])('`%s` grava %j', (command, esperado) => {
    expect(terminal(command)).toEqual(esperado);
  });

  it('o composto vira UM padrão por segmento, sem repetir', () => {
    expect(terminal('cd /work && npm test && npm test -- --run')).toEqual([
      'Terminal(cd)',
      'Terminal(npm test)',
    ]);
  });

  it('argumento que não é subcomando (caminho, arquivo) generaliza para o verbo', () => {
    expect(terminal('cat src/index.ts')).toEqual(['Terminal(cat)']);
    expect(terminal('cd ../lib')).toEqual(['Terminal(cd)']);
  });

  it('argumento que PARECE palavra fica como subcomando — o lado estreito da dúvida', () => {
    // `src` não se distingue de um subcomando sem uma lista de verbos (Z/AD):
    // tratá-lo como subcomando grava MENOS do que o verbo sozinho.
    expect(terminal('cd src')).toEqual(['Terminal(cd src)']);
  });

  it('flag logo depois do verbo NÃO generaliza: a forma é onde verbo e invocação divergem (Z/AD)', () => {
    expect(terminal('ls -la src')).toEqual(['Terminal(ls -la src)']);
    expect(terminal('git -C /work status')).toEqual([
      'Terminal(git -C /work status)',
    ]);
  });

  it('verbo + subcomando que é PREFIXO de um teto da RN-418 não generaliza — fica o segmento exato', () => {
    expect(terminal('git remote -v')).toEqual(['Terminal(git remote -v)']);
    expect(terminal('gh pr list')).toEqual(['Terminal(gh pr list)']);
    expect(terminal('kubectl get pods')).toEqual(['Terminal(kubectl get)']);
  });

  it('o padrão exato preserva o token com espaço (aspas), e casa de volta o mesmo segmento', () => {
    const [padrao] = terminal('grep -rn "a b" src');
    const segmento = parseCommand('grep -rn "a b" src')[0];
    expect(matchesPattern(padrao, 'terminal', segmento)).toBe(true);
  });

  it('o padrão gravado casa o PRÓXIMO comando do mesmo verbo + subcomando', () => {
    const [padrao] = terminal('npm test');
    expect(
      matchesPattern(
        padrao,
        'terminal',
        parseCommand('npm test -- --coverage')[0],
      ),
    ).toBe(true);
    expect(
      matchesPattern(
        padrao,
        'terminal',
        parseCommand('npm install left-pad')[0],
      ),
    ).toBe(false);
  });

  it('caso de falha: comando vazio não vira padrão nenhum', () => {
    expect(terminal('')).toEqual([]);
  });

  it('tipos que não são terminal seguem com o padrão do TIPO', () => {
    expect(patternsForAction('git_commit', {})).toEqual(['GitCommit()']);
  });
});

describe('unidadeDoSegmento', () => {
  it('devolve os tokens da unidade, nunca mais do que o segmento tem', () => {
    expect(unidadeDoSegmento(['npm', 'test', '--', '--watch'])).toEqual([
      'npm',
      'test',
    ]);
    expect(unidadeDoSegmento(['cat', 'x.ts'])).toEqual(['cat']);
  });

  it('caso de falha: segmento que, até exato, é prefixo de um teto não vira padrão nenhum', () => {
    expect(unidadeDoSegmento(['git'])).toBeNull();
    expect(terminal('git && npm test')).toEqual(['Terminal(npm test)']);
    expect(terminal('git')).toEqual([]);
  });
});
