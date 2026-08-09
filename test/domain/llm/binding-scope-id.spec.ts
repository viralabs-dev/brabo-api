import { describe, expect, it } from 'vitest';
import {
  assertScopeIdBemFormado,
  chaveDeAgente,
  chaveDeArea,
  ehEscopoDeProjeto,
  lerChaveDeProjeto,
  ScopeIdSemProjetoError,
} from '../../../src/domain/llm/binding-scope-id';

const PROJETO = '5f2b7c9e-1111-4222-8333-444455556666';

describe('chave de escopo por projeto (ADR 0064)', () => {
  it('caminho feliz: o formato é `<projectId>:<chave>` e volta inteiro', () => {
    expect(chaveDeAgente(PROJETO, 'dev-api')).toBe(`${PROJETO}:dev-api`);
    expect(chaveDeArea(PROJETO, 'qa')).toBe(`${PROJETO}:qa`);

    expect(lerChaveDeProjeto(chaveDeAgente(PROJETO, 'dev-api'))).toEqual({
      projectId: PROJETO,
      chave: 'dev-api',
    });
  });

  it('só `agent` e `area` são por projeto — os outros três guardam UUID puro', () => {
    expect(ehEscopoDeProjeto('agent')).toBe(true);
    expect(ehEscopoDeProjeto('area')).toBe(true);
    expect(ehEscopoDeProjeto('workspace')).toBe(false);
    expect(ehEscopoDeProjeto('project')).toBe(false);
    expect(ehEscopoDeProjeto('session')).toBe(false);
  });

  it('corta no PRIMEIRO `:` — um slug com dois pontos não vira três pedaços', () => {
    expect(lerChaveDeProjeto(`${PROJETO}:psicologo:leve`)).toEqual({
      projectId: PROJETO,
      chave: 'psicologo:leve',
    });
  });

  it('falha: o slug puro do formato antigo é recusado, não gravado', () => {
    // É o caso REAL que o ADR 0064 fecha: gravar `qa` criaria um binding que a
    // cascata nunca mais acharia — invisível, e não um erro.
    expect(() => assertScopeIdBemFormado('agent', 'qa')).toThrow(
      ScopeIdSemProjetoError,
    );
    expect(() => assertScopeIdBemFormado('area', 'qa')).toThrow(
      ScopeIdSemProjetoError,
    );
    expect(lerChaveDeProjeto('qa')).toBeNull();
  });

  it('falha: chave vazia dos dois lados também é malformada', () => {
    expect(lerChaveDeProjeto(`${PROJETO}:`)).toBeNull();
    expect(lerChaveDeProjeto(`:qa`)).toBeNull();
  });

  it('escopo que não é por projeto passa com UUID puro', () => {
    expect(() => assertScopeIdBemFormado('project', PROJETO)).not.toThrow();
    expect(() => assertScopeIdBemFormado('session', PROJETO)).not.toThrow();
  });
});
