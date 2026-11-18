import { describe, it, expect } from 'vitest';
import { SubirCicloDeVidaDoContainerUseCase } from '../../../../src/application/use-cases/containers/subir-ciclo-de-vida-do-container.use-case';

function build(status: string | null) {
  const to: string[] = [];
  const uc = new SubirCicloDeVidaDoContainerUseCase(
    { execute: () => Promise.resolve(status ? { status } : null) } as never,
    {
      execute: (_p: string, t: string) => {
        to.push(t);
        return Promise.resolve();
      },
    } as never,
  );
  return { uc, to };
}

describe('SubirCicloDeVidaDoContainerUseCase — recriado (RN-1368)', () => {
  it('stopped + recriado passa por removed -> provisioning -> running', async () => {
    const { uc, to } = build('stopped');
    await uc.execute('p', 'c', true);
    expect(to).toEqual(['removed', 'provisioning', 'running']);
  });

  it('stopped sem recriado segue direto para running', async () => {
    const { uc, to } = build('stopped');
    await uc.execute('p', 'c');
    expect(to).toEqual(['running']);
  });
});
