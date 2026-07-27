import { describe, it, expect } from 'vitest';
import {
  isDuplicateOfRejected,
  normalizeInstruction,
} from '../../../src/domain/instructions/patch-dedup';

describe('normalizeInstruction', () => {
  it('normaliza CRLF, espaços à direita e linhas em branco nas bordas', () => {
    expect(normalizeInstruction('\r\na \r\nb   \n\n')).toBe('a\nb');
  });

  it('PRESERVA indentação à esquerda (pode ser semântica: listas, blocos de código)', () => {
    expect(normalizeInstruction('a\n  indentado\n')).toBe('a\n  indentado');
  });
});

describe('isDuplicateOfRejected', () => {
  const rejected = ['Você é o dev-backend.\nNão explique o básico.\n'];

  it('conteúdo idêntico a um negado é duplicata', () => {
    expect(
      isDuplicateOfRejected(
        'Você é o dev-backend.\nNão explique o básico.\n',
        rejected,
      ),
    ).toBe(true);
  });

  // CRLF, espaço à direita e padding de linhas em branco são ruído de
  // formatação — repropor o "mesmo" patch só por isso seria spam pro
  // usuário, então o dedup enxerga através deles.
  it('diferença só de CRLF/espaço-à-direita/linhas-em-branco ainda é duplicata', () => {
    expect(
      isDuplicateOfRejected(
        'Você é o dev-backend.   \r\nNão explique o básico.  \n\n\n',
        rejected,
      ),
    ).toBe(true);
  });

  // Indentação à esquerda é preservada de propósito (pode mudar o
  // sentido em markdown), então conta como patch diferente.
  it('mudança de indentação à esquerda NÃO é duplicata', () => {
    expect(
      isDuplicateOfRejected(
        'Você é o dev-backend.\n  Não explique o básico.\n',
        rejected,
      ),
    ).toBe(false);
  });

  it('conteúdo genuinamente diferente pode ser reproposto', () => {
    expect(
      isDuplicateOfRejected(
        'Você é o dev-backend.\nAssuma familiaridade com NestJS.\n',
        rejected,
      ),
    ).toBe(false);
  });

  it('sem histórico de negados, nada é duplicata', () => {
    expect(isDuplicateOfRejected('qualquer coisa', [])).toBe(false);
  });

  it('compara contra TODOS os negados, não só o último', () => {
    const many = ['patch A', 'patch B', 'patch C'];
    expect(isDuplicateOfRejected('patch B', many)).toBe(true);
  });
});
