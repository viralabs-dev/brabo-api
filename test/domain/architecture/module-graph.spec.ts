import { describe, it, expect } from 'vitest';
import {
  detectCycle,
  assertNoCycle,
  ModuleCycleError,
  type ModuleNode,
} from '../../../src/domain/architecture/module-graph';

function mod(name: string, dependsOn: string[] = []): ModuleNode {
  return { name, stack: 'ts', responsibility: name, dependsOn };
}

describe('module-graph', () => {
  it('grafo acíclico → null / não lança', () => {
    const modules = [mod('api', ['db']), mod('web', ['api']), mod('db')];
    expect(detectCycle(modules)).toBeNull();
    expect(() => assertNoCycle(modules)).not.toThrow();
  });

  it('ciclo direto A→B→A é detectado e rejeitado', () => {
    const modules = [mod('a', ['b']), mod('b', ['a'])];
    const cycle = detectCycle(modules);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]); // fecha o ciclo
    expect(() => assertNoCycle(modules)).toThrow(ModuleCycleError);
  });

  it('ciclo indireto A→B→C→A é detectado', () => {
    const modules = [mod('a', ['b']), mod('b', ['c']), mod('c', ['a'])];
    expect(() => assertNoCycle(modules)).toThrow(ModuleCycleError);
    const err = detectCycle(modules);
    expect(err).toContain('a');
  });

  it('auto-dependência A→A é ciclo', () => {
    expect(detectCycle([mod('a', ['a'])])).not.toBeNull();
  });

  it('aresta para módulo inexistente é ignorada (não é ciclo)', () => {
    expect(detectCycle([mod('a', ['fantasma'])])).toBeNull();
  });

  it('o erro carrega o ciclo', () => {
    try {
      assertNoCycle([mod('x', ['y']), mod('y', ['x'])]);
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ModuleCycleError);
      expect((e as ModuleCycleError).cycle.length).toBeGreaterThan(1);
    }
  });
});
