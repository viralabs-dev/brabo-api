import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARCAS_DA_CORRECAO,
  menuComPiso,
} from '../../../src/domain/llm/tool-router';

// AT-523, RN-857: o passo de correção do dev agent ganha escrita e terminal.
const CATALOGO = [
  'read_file',
  'search_workspace',
  'write_file',
  'terminal',
  'report_done',
  'report_blocked',
];
const CORRECAO = {
  role: 'user',
  content:
    'O gate "qa" pediu correção nesta PR (mesma branch, mesmo worktree). Motivo: x.',
};

describe('menuComPiso no passo de correção (RN-857)', () => {
  it('dev agent em correção recebe write_file e terminal', () => {
    const menu = menuComPiso(CATALOGO, ['read_file'], 'dev-api', [
      { role: 'user', content: 'task' },
      CORRECAO,
      { role: 'assistant', content: '' },
      { role: 'system', content: 'ambiente' },
    ]);
    expect(menu).toEqual(
      expect.arrayContaining(['write_file', 'terminal', 'read_file']),
    );
  });

  it('passo comum de leitura do dev não alarga', () => {
    const menu = menuComPiso(CATALOGO, ['read_file'], 'dev-api', [
      { role: 'user', content: 'Implemente a task' },
    ]);
    expect(menu).toEqual(['read_file', 'report_done', 'report_blocked']);
  });

  it('outro agente com a mesma mensagem não ganha', () => {
    expect(
      menuComPiso(CATALOGO, ['read_file'], 'dev-lead', [CORRECAO]),
    ).toEqual(['read_file']);
    expect(
      menuComPiso(CATALOGO, ['read_file'], 'qa-automacao', [CORRECAO]),
    ).not.toContain('write_file');
  });

  it('as marcas existem no texto que o engine monta', () => {
    const fonte = readFileSync(
      join(__dirname, '../../../../engine/lib/engine/dev/dev_agent_server.ex'),
      'utf8',
    );
    for (const marca of MARCAS_DA_CORRECAO) {
      expect(fonte).toContain(marca);
    }
  });
});
