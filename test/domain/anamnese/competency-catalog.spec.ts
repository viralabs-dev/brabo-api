import { describe, it, expect } from 'vitest';
import {
  assertAllowedCompetency,
  CompetencyNotAllowedError,
  deriveCatalog,
  isAllowedCompetency,
  normalizeCompetency,
  PROCESS_COMPETENCIES,
} from '../../../src/domain/anamnese/competency-catalog';

describe('deriveCatalog', () => {
  it('sempre inclui as competências de processo, mesmo sem module_map', () => {
    const catalog = deriveCatalog([]);
    for (const competency of PROCESS_COMPETENCIES) {
      expect(catalog.has(competency)).toBe(true);
    }
  });

  it('inclui as stacks do module_map, normalizadas', () => {
    const catalog = deriveCatalog(['NestJS', 'React 19']);
    expect(isAllowedCompetency('nestjs', catalog)).toBe(true);
    expect(isAllowedCompetency('  NestJS  ', catalog)).toBe(true);
    expect(isAllowedCompetency('react 19', catalog)).toBe(true);
  });

  it('deduplica stacks equivalentes por normalização', () => {
    const catalog = deriveCatalog(['NestJS', 'nestjs ', 'NESTJS']);
    const stackEntries = [...catalog].filter(
      (c) => !(PROCESS_COMPETENCIES as readonly string[]).includes(c),
    );
    expect(stackEntries).toEqual(['nestjs']);
  });

  it('ignora stack vazia/em branco', () => {
    const catalog = deriveCatalog(['', '   ']);
    expect(catalog.size).toBe(PROCESS_COMPETENCIES.length);
  });
});

describe('guarda-corpo: competência fora do catálogo é rejeitada', () => {
  const catalog = deriveCatalog(['NestJS']);

  // O ponto central do item 4 da CLAUDE.md: atributos sensíveis são
  // ESTRUTURALMENTE inalcançáveis — não há caminho de escrita que aceite.
  it.each([
    'saúde mental',
    'ansiedade',
    'idade',
    'gênero',
    'religião',
    'orientação sexual',
    'personalidade',
    'humor',
  ])('rejeita atributo sensível: %s', (sensitive) => {
    expect(isAllowedCompetency(sensitive, catalog)).toBe(false);
    expect(() => assertAllowedCompetency(sensitive, catalog)).toThrow(
      CompetencyNotAllowedError,
    );
  });

  it('rejeita competência técnica que não é stack do projeto nem processo', () => {
    expect(isAllowedCompetency('cobol', catalog)).toBe(false);
  });

  it('aceita stack do projeto e competência de processo', () => {
    expect(isAllowedCompetency('NestJS', catalog)).toBe(true);
    expect(isAllowedCompetency('git', catalog)).toBe(true);
  });

  it('o erro carrega a competência ofensora', () => {
    try {
      assertAllowedCompetency('saúde', catalog);
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(CompetencyNotAllowedError);
      expect((error as CompetencyNotAllowedError).competency).toBe('saúde');
    }
  });
});

describe('normalizeCompetency', () => {
  it('minúsculas, trim e colapso de espaços internos', () => {
    expect(normalizeCompetency('  Nest   JS ')).toBe('nest js');
  });
});
