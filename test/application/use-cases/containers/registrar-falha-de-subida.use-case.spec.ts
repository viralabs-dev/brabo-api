import { describe, it, expect } from 'vitest';
import { RegistrarFalhaDeSubidaUseCase } from '../../../../src/application/use-cases/containers/registrar-falha-de-subida.use-case';

function build(ciclo: { status: string } | null, quebra = false) {
  const transicoes: Array<[string, unknown]> = [];
  const uc = new RegistrarFalhaDeSubidaUseCase(
    { execute: () => Promise.resolve(ciclo) } as never,
    {
      execute: (_p: string, to: string, input: unknown) => {
        if (quebra) return Promise.reject(new Error('boom'));
        transicoes.push([to, input]);
        return Promise.resolve();
      },
    } as never,
  );
  return { uc, transicoes };
}

describe('RegistrarFalhaDeSubidaUseCase (RN-1538)', () => {
  it.each(['running', 'provisioning', 'stopped'])(
    'ciclo %s vai direto a failed com o motivo',
    async (status) => {
      const { uc, transicoes } = build({ status });
      await uc.execute('p', 'motivo');
      expect(transicoes).toEqual([['failed', { failureReason: 'motivo' }]]);
    },
  );

  it.each([null, { status: 'removed' }])(
    'sem linha ou removed passa por provisioning',
    async (ciclo) => {
      const { uc, transicoes } = build(ciclo);
      await uc.execute('p', 'motivo');
      expect(transicoes.map((t) => t[0])).toEqual(['provisioning', 'failed']);
    },
  );

  it('já failed não regrava; erro da gravação não propaga', async () => {
    const a = build({ status: 'failed' });
    await a.uc.execute('p', 'm');
    expect(a.transicoes).toEqual([]);
    await expect(
      build({ status: 'running' }, true).uc.execute('p', 'm'),
    ).resolves.toBeUndefined();
  });
});
