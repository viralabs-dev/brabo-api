import { describe, it, expect } from 'vitest';
import {
  matchesPattern,
  parseCommand,
} from '../../../src/domain/actions/command-matcher';

describe('parseCommand', () => {
  it('comando simples vira um único segmento', () => {
    expect(parseCommand('echo oi')).toEqual([['echo', 'oi']]);
  });

  it('divide em segmentos por &&', () => {
    expect(parseCommand('pnpm test && curl http://x')).toEqual([
      ['pnpm', 'test'],
      ['curl', 'http://x'],
    ]);
  });

  it('divide em segmentos por ;', () => {
    expect(parseCommand('echo oi; rm -rf /')).toEqual([
      ['echo', 'oi'],
      ['rm', '-rf', '/'],
    ]);
  });

  it('divide em segmentos por | (pipe também conta como fronteira)', () => {
    expect(parseCommand('echo a | grep b')).toEqual([
      ['echo', 'a'],
      ['grep', 'b'],
    ]);
  });

  it('token com glob (*) mantém o padrão literal, não vira objeto opaco', () => {
    expect(parseCommand('pnpm test:*')).toEqual([['pnpm', 'test:*']]);
  });
});

describe('matchesPattern', () => {
  it('rótulo de tipo errado nunca casa, mesmo com conteúdo idêntico', () => {
    expect(
      matchesPattern('GitPush(pnpm test)', 'terminal', ['pnpm', 'test']),
    ).toBe(false);
  });

  it('terminal: match exato de tokens', () => {
    expect(
      matchesPattern('Terminal(echo oi)', 'terminal', ['echo', 'oi']),
    ).toBe(true);
    expect(
      matchesPattern('Terminal(echo oi)', 'terminal', ['echo', 'tchau']),
    ).toBe(false);
  });

  it('terminal: prefixo com wildcard no último token casa só o prefixo do token', () => {
    expect(
      matchesPattern('Terminal(pnpm test:*)', 'terminal', [
        'pnpm',
        'test:unit',
      ]),
    ).toBe(true);
    expect(
      matchesPattern('Terminal(pnpm test:*)', 'terminal', ['pnpm', 'testx']),
    ).toBe(false);
  });

  it('terminal: padrão é prefixo do comando — tokens extras no final são permitidos', () => {
    expect(
      matchesPattern('Terminal(pnpm test)', 'terminal', [
        'pnpm',
        'test',
        '--coverage',
      ]),
    ).toBe(true);
  });

  it('terminal: padrão mais longo que o comando nunca casa', () => {
    expect(
      matchesPattern('Terminal(pnpm test --coverage)', 'terminal', [
        'pnpm',
        'test',
      ]),
    ).toBe(false);
  });

  it('tipos não-terminais casam só pelo padrão exato "Tipo()"', () => {
    expect(matchesPattern('GitPush()', 'git_push')).toBe(true);
    expect(matchesPattern('GitPush(qualquer coisa)', 'git_push')).toBe(false);
  });

  it('padrão malformado (sem parênteses) nunca casa', () => {
    expect(matchesPattern('Terminal echo oi', 'terminal', ['echo', 'oi'])).toBe(
      false,
    );
  });
});
