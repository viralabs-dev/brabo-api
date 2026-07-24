import { describe, it, expect } from 'vitest';
import { diffLines } from '../../../src/domain/instructions/text-diff';

describe('diffLines', () => {
  it('textos idênticos: só contexto, zero adições/remoções', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
    expect(diff.lines.every((l) => l.kind === 'ctx')).toBe(true);
    expect(diff.lines).toHaveLength(3);
  });

  it('linha adicionada no meio', () => {
    const diff = diffLines('a\nc\n', 'a\nb\nc\n');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(0);
    expect(diff.lines.map((l) => [l.kind, l.content])).toEqual([
      ['ctx', 'a'],
      ['add', 'b'],
      ['ctx', 'c'],
    ]);
  });

  it('linha removida no meio', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nc\n');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(1);
    expect(diff.lines.map((l) => [l.kind, l.content])).toEqual([
      ['ctx', 'a'],
      ['del', 'b'],
      ['ctx', 'c'],
    ]);
  });

  it('linha substituída conta uma remoção e uma adição', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nX\nc\n');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
  });

  it('de vazio pra conteúdo: tudo adição', () => {
    const diff = diffLines('', 'a\nb\n');
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
  });

  it('de conteúdo pra vazio: tudo remoção', () => {
    const diff = diffLines('a\nb\n', '');
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(2);
  });

  it('numera add/ctx pelo arquivo NOVO e del pelo ANTIGO', () => {
    const diff = diffLines('a\nb\n', 'a\nX\n');
    const del = diff.lines.find((l) => l.kind === 'del');
    const add = diff.lines.find((l) => l.kind === 'add');
    expect(del?.lineNo).toBe(2);
    expect(add?.lineNo).toBe(2);
  });

  it('texto sem newline final não gera linha vazia fantasma', () => {
    const diff = diffLines('a\nb', 'a\nb');
    expect(diff.lines).toHaveLength(2);
  });

  it('apêndice ao final é adição pura', () => {
    const diff = diffLines('a\n', 'a\nb\nc\n');
    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(0);
  });
});
