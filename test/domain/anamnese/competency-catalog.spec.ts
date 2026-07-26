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

describe('stack composta (texto livre do Arquiteto)', () => {
  // `ModuleMapModule.stack` é UMA string escrita por LLM, e na prática lista
  // várias tecnologias. Sem tokenizar, o catálogo ganhava só a frase inteira,
  // a emissão natural "nestjs" caía fora e o LOTE INTEIRO era rejeitado — a
  // Anamnese não conseguia gravar perfil em nenhum projeto realista.
  it('libera cada tecnologia de uma stack com "+"', () => {
    const catalog = deriveCatalog(['NestJS + Drizzle + Postgres']);

    expect(isAllowedCompetency('nestjs', catalog)).toBe(true);
    expect(isAllowedCompetency('drizzle', catalog)).toBe(true);
    expect(isAllowedCompetency('Postgres', catalog)).toBe(true);
  });

  it('mantém a frase inteira no catálogo', () => {
    // Quem escreveu "Node.js" (um token só, com ponto) não pode deixar de
    // valer por causa da tokenização.
    const catalog = deriveCatalog(['NestJS + Drizzle']);

    expect(isAllowedCompetency('nestjs + drizzle', catalog)).toBe(true);
    expect(isAllowedCompetency('Node.js', deriveCatalog(['Node.js']))).toBe(
      true,
    );
  });

  it('aceita vírgula, barra e & como separadores', () => {
    const catalog = deriveCatalog(['React 19, Vite', 'CI/CD', 'Jest & Vitest']);

    expect(isAllowedCompetency('react 19', catalog)).toBe(true);
    expect(isAllowedCompetency('vite', catalog)).toBe(true);
    expect(isAllowedCompetency('ci', catalog)).toBe(true);
    expect(isAllowedCompetency('cd', catalog)).toBe(true);
    expect(isAllowedCompetency('vitest', catalog)).toBe(true);
  });

  it('token de 1 caractere não entra (não é competência)', () => {
    const catalog = deriveCatalog(['Go + K']);

    expect(isAllowedCompetency('go', catalog)).toBe(true);
    expect(isAllowedCompetency('k', catalog)).toBe(false);
  });

  it('tokenizar NÃO afrouxa o guarda-corpo', () => {
    // O ponto do ADR 0016 §1 continua valendo: mais tokens permitidos não
    // pode abrir caminho pra atributo sensível.
    const catalog = deriveCatalog(['NestJS + Drizzle + Postgres, React']);

    for (const sensitive of ['saúde mental', 'ansiedade', 'personalidade']) {
      expect(isAllowedCompetency(sensitive, catalog)).toBe(false);
    }
    expect(isAllowedCompetency('cobol', catalog)).toBe(false);
  });
});
