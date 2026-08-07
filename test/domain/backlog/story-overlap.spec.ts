import { describe, it, expect } from 'vitest';
import {
  normalizarTitulo,
  tituloDuplicado,
  regrasJaCobertas,
} from '../../../src/domain/backlog/story-overlap';
import type { Story } from '../../../src/domain/backlog/backlog.entity';

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: 'story-1',
    epicId: 'epic-1',
    projectId: 'p1',
    sessionId: 's1',
    title: 't',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    moduleIds: [],
    status: 'draft',
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('normalizarTitulo', () => {
  it('caixa, acento e espaço em excesso não fazem título novo', () => {
    const canonico = normalizarTitulo('Saudação Determinística');
    expect(normalizarTitulo('  saudacao   DETERMINISTICA ')).toBe(canonico);
  });

  it('pontuação FICA', () => {
    expect(normalizarTitulo('GET /hello')).not.toBe(normalizarTitulo('GET hello'));
  });
});

describe('tituloDuplicado', () => {
  it('acha o mesmo título escrito diferente', () => {
    const achada = tituloDuplicado('ENDPOINT PUBLICO', [
      story({ id: 'v', title: 'Endpoint público' }),
    ]);
    expect(achada?.id).toBe('v');
  });

  it('título inédito não é duplicata', () => {
    expect(tituloDuplicado('Outra', [story({ title: 'Endpoint público' })])).toBeNull();
  });

  it('título vazio não colide', () => {
    expect(tituloDuplicado('   ', [story({ title: '' })])).toBeNull();
  });

  it('projeto sem histórias nunca acusa', () => {
    expect(tituloDuplicado('Qualquer', [])).toBeNull();
  });
});

describe('regrasJaCobertas', () => {
  it('acusa quando todas as regras citadas já estavam cobertas', () => {
    const achada = regrasJaCobertas(
      ['r1'],
      [story({ id: 'v', businessRuleIds: ['r1', 'r2'] })],
    );
    expect(achada?.id).toBe('v');
  });

  it('conjuntos idênticos também contam', () => {
    expect(
      regrasJaCobertas(['r1', 'r2'], [story({ businessRuleIds: ['r2', 'r1'] })]),
    ).not.toBeNull();
  });

  it('cobertura NOVA não é sobreposição, mesmo com regra em comum', () => {
    // O caso que torna "intersecção" um critério ruim: histórias
    // legitimamente compartilham regras o tempo todo.
    expect(
      regrasJaCobertas(['r1', 'r9'], [story({ businessRuleIds: ['r1'] })]),
    ).toBeNull();
  });

  it('história sem regra citada não gera aviso', () => {
    // Tratar o conjunto vazio como subconjunto de tudo acusaria TODAS.
    expect(regrasJaCobertas([], [story({ businessRuleIds: ['r1'] })])).toBeNull();
  });

  it('história existente sem regras não serve de cobertura', () => {
    expect(regrasJaCobertas(['r1'], [story({ businessRuleIds: [] })])).toBeNull();
  });

  it('o par do achado R passa — sobreposição semântica não é pega aqui', () => {
    // Títulos diferentes, justificativas diferentes: nada mecânico a ver.
    // Está afirmado como teste para o limite ficar visível, não implícito.
    const nova = 'Endpoint público GET /hello que responde saudação imediata';
    const existentes = [
      story({ title: 'Endpoint público de saudação determinística', businessRuleIds: ['r1'] }),
    ];

    expect(tituloDuplicado(nova, existentes)).toBeNull();
    expect(regrasJaCobertas(['r2'], existentes)).toBeNull();
  });
});
