import { describe, expect, it } from 'vitest';
import { menuComPiso } from '../../../src/domain/llm/tool-router';

const CATALOGO_DEV = [
  'read_file',
  'write_file',
  'terminal',
  'report_done',
  'report_blocked',
];

describe('piso do Jev dos dev agents (RN-839)', () => {
  it('recorte que deixa só `terminal` para dev-api: report_done e report_blocked continuam', () => {
    expect(menuComPiso(CATALOGO_DEV, ['terminal'], 'dev-api')).toEqual([
      'terminal',
      'report_done',
      'report_blocked',
    ]);
  });

  it('falha: dev-lead e outro agente não ganham as ferramentas de desfecho', () => {
    expect(menuComPiso(CATALOGO_DEV, ['terminal'], 'dev-lead')).toEqual([
      'terminal',
    ]);
    expect(menuComPiso(CATALOGO_DEV, ['terminal'], 'qa-automacao')).toEqual([
      'terminal',
    ]);
  });

  it('o piso nunca acrescenta o que o catálogo do passo não tem (P3)', () => {
    expect(menuComPiso(['terminal'], ['terminal'], 'dev-api')).toEqual([
      'terminal',
    ]);
  });
});
