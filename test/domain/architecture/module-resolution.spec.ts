import { describe, it, expect } from 'vitest';
import {
  missingModules,
  allModulesResolved,
  assertModulesResolved,
  StoryModulesMissingError,
} from '../../../src/domain/architecture/module-resolution';

const names = ['api', 'web', 'db'];

describe('module-resolution', () => {
  it('todos os módulos existem → resolvido', () => {
    expect(missingModules(['api', 'db'], names)).toEqual([]);
    expect(allModulesResolved(['api', 'db'], names)).toBe(true);
    expect(() => assertModulesResolved(['api'], names)).not.toThrow();
  });

  it('moduleIds vazio → resolvido (pendência, não bloqueio)', () => {
    expect(allModulesResolved([], names)).toBe(true);
  });

  it('módulo inexistente → faltante + erro', () => {
    expect(missingModules(['api', 'cache'], names)).toEqual(['cache']);
    expect(allModulesResolved(['cache'], names)).toBe(false);
    expect(() => assertModulesResolved(['api', 'cache'], names)).toThrow(
      StoryModulesMissingError,
    );
  });

  it('o erro lista os faltantes', () => {
    try {
      assertModulesResolved(['x', 'y'], names);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect((e as StoryModulesMissingError).missing).toEqual(['x', 'y']);
    }
  });
});
