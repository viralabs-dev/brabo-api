import { describe, expect, it } from 'vitest';
import {
  derivarRecursosMinimos,
  explicarRecursosMinimos,
  RecursosDoModuloInvalidosError,
  resolverRecursosDaSubida,
  validarRecursosDoModulo,
  validarSomaNoTeto,
} from '../../../src/domain/containers/recursos-minimos';
import {
  ImagemInvalidaError,
  RECURSOS_PADRAO,
} from '../../../src/domain/containers/project-container';

const pequeno = { cpus: 0.5, memoryMb: 512, pidsLimit: 64 };

describe('derivarRecursosMinimos (RN-683)', () => {
  it('todos declarados: a SOMA, podendo ficar abaixo do padrão', () => {
    const m = derivarRecursosMinimos([
      { name: 'api', resources: pequeno },
      { name: 'web', resources: { cpus: 0.25, memoryMb: 256, pidsLimit: 32 } },
    ]);
    expect(m.recursos).toEqual({ cpus: 0.75, memoryMb: 768, pidsLimit: 96 });
    expect(m.semDeclaracao).toEqual([]);
  });

  it('soma de frações não vira ruído de ponto flutuante', () => {
    const m = derivarRecursosMinimos([
      { name: 'a', resources: { ...pequeno, cpus: 0.1 } },
      { name: 'b', resources: { ...pequeno, cpus: 0.2 } },
    ]);
    expect(m.recursos.cpus).toBe(0.3);
  });

  it('nenhum declarado (todo mapa antigo): exatamente o padrão de hoje', () => {
    const m = derivarRecursosMinimos([{ name: 'api' }, { name: 'web' }]);
    expect(m.recursos).toEqual(RECURSOS_PADRAO);
    expect(explicarRecursosMinimos(m)).toContain('nenhum módulo');
  });

  it('parcial: piso no padrão campo a campo, e quem faltou é nomeado', () => {
    const m = derivarRecursosMinimos([
      { name: 'api', resources: { cpus: 3, memoryMb: 512, pidsLimit: 64 } },
      { name: 'worker' },
    ]);
    expect(m.recursos).toEqual({
      cpus: 3,
      memoryMb: RECURSOS_PADRAO.memoryMb,
      pidsLimit: RECURSOS_PADRAO.pidsLimit,
    });
    expect(explicarRecursosMinimos(m)).toContain('worker não declarou');
  });

  it('soma acima do teto é recusada', () => {
    const m = derivarRecursosMinimos([
      { name: 'a', resources: { cpus: 1, memoryMb: 9000, pidsLimit: 64 } },
      { name: 'b', resources: { cpus: 1, memoryMb: 9000, pidsLimit: 64 } },
    ]);
    expect(() => validarSomaNoTeto(m)).toThrow(RecursosDoModuloInvalidosError);
  });
});

describe('validarRecursosDoModulo', () => {
  it('ausente é válido; os três presentes passam', () => {
    expect(validarRecursosDoModulo('api', undefined)).toBeUndefined();
    expect(validarRecursosDoModulo('api', pequeno)).toEqual(pequeno);
  });

  it('recusa campo faltando, não-positivo e acima do teto', () => {
    expect(() => validarRecursosDoModulo('api', { cpus: 1 })).toThrow(
      /declare os três/,
    );
    expect(() =>
      validarRecursosDoModulo('api', { ...pequeno, pidsLimit: 0 }),
    ).toThrow(RecursosDoModuloInvalidosError);
    expect(() =>
      validarRecursosDoModulo('api', { ...pequeno, memoryMb: 999999 }),
    ).toThrow(/teto/);
  });
});

describe('resolverRecursosDaSubida', () => {
  const minimo = derivarRecursosMinimos([{ name: 'api', resources: pequeno }]);

  it('omitido vira o mínimo; acima do mínimo vale', () => {
    expect(resolverRecursosDaSubida({}, minimo)).toEqual(pequeno);
    expect(resolverRecursosDaSubida(undefined, minimo)).toEqual(pequeno);
    expect(resolverRecursosDaSubida({ cpus: 2 }, minimo)).toEqual({
      ...pequeno,
      cpus: 2,
    });
  });

  it('abaixo do mínimo é recusado nomeando o mínimo', () => {
    expect(() => resolverRecursosDaSubida({ memoryMb: 128 }, minimo)).toThrow(
      ImagemInvalidaError,
    );
    expect(() => resolverRecursosDaSubida({ memoryMb: 128 }, minimo)).toThrow(
      /abaixo do mínimo de 512/,
    );
  });
});
