import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DeleteProjectUseCase } from '../../../../src/application/use-cases/iam/delete-project.use-case';

function build(opts: { modo?: string; brokerFalha?: boolean } = {}) {
  const ordem: string[] = [];
  const remove = vi.fn(() => {
    ordem.push('broker.remove');
    return opts.brokerFalha
      ? Promise.reject(new Error('broker fora'))
      : Promise.resolve();
  });
  const projects = {
    findById: () =>
      Promise.resolve({ id: 'p', executionMode: opts.modo ?? 'container' }),
    remove: () => {
      ordem.push('projects.remove');
      return Promise.resolve({ id: 'p' });
    },
  };
  return {
    uc: new DeleteProjectUseCase(projects as never, { remove } as never),
    ordem,
    remove,
  };
}

describe('DeleteProjectUseCase (RN-1369)', () => {
  it('remove o container ANTES de apagar a linha', async () => {
    const { uc, ordem } = build();
    await uc.execute('p');
    expect(ordem).toEqual(['broker.remove', 'projects.remove']);
  });

  it('falha do broker não bloqueia o apagar', async () => {
    const { uc, ordem } = build({ brokerFalha: true });
    await expect(uc.execute('p')).resolves.toEqual({ id: 'p' });
    expect(ordem).toEqual(['broker.remove', 'projects.remove']);
  });

  it('modo runner não chama o broker', async () => {
    const { uc, remove } = build({ modo: 'runner' });
    await uc.execute('p');
    expect(remove).not.toHaveBeenCalled();
  });

  it('projeto inexistente segue 404', async () => {
    const { uc } = build();
    (uc as never as { projects: { remove: () => unknown } }).projects.remove =
      () => Promise.resolve(null);
    await expect(uc.execute('p')).rejects.toBeInstanceOf(NotFoundException);
  });
});
