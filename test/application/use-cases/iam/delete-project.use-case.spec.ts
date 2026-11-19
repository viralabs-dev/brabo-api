import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DeleteProjectUseCase } from '../../../../src/application/use-cases/iam/delete-project.use-case';

function build(
  opts: { modo?: string; brokerFalha?: boolean; orfaoFalha?: boolean } = {},
) {
  const ordem: string[] = [];
  const remove = vi.fn(() => {
    ordem.push('broker.remove');
    return opts.brokerFalha
      ? Promise.reject(new Error('broker fora'))
      : Promise.resolve();
  });
  const removeQa = vi.fn(() => {
    ordem.push('broker.removeQa');
    return Promise.resolve();
  });
  const removerOrfao = vi.fn(() => {
    ordem.push('broker.removerOrfao');
    return opts.orfaoFalha
      ? Promise.reject(new Error('broker fora'))
      : Promise.resolve();
  });
  const recursos = {
    marcarRemovendoDoProjeto: vi.fn(() => {
      ordem.push('recursos.removendo');
      return Promise.resolve(1);
    }),
    concluirRemocaoDoProjeto: vi.fn(() => Promise.resolve()),
  };
  const qa = {
    listarParaLimpeza: () =>
      Promise.resolve([{ taskId: 'a1b2c3d4-0000-4000-8000-000000000001' }]),
  };
  const projects = {
    findById: () =>
      Promise.resolve({ id: 'p', executionMode: opts.modo ?? 'container' }),
    remove: () => {
      ordem.push('projects.remove');
      return Promise.resolve({ id: 'p' });
    },
  };
  return {
    uc: new DeleteProjectUseCase(
      projects as never,
      { remove, removeQa, removerOrfao } as never,
      qa as never,
      recursos as never,
      {
        runInTransaction: (fn: () => unknown) => Promise.resolve(fn()),
      } as never,
    ),
    ordem,
    remove,
    removerOrfao,
    recursos,
  };
}

describe('DeleteProjectUseCase (RN-1369)', () => {
  it('remove o container ANTES de apagar a linha', async () => {
    const { uc, ordem } = build();
    await uc.execute('p');
    expect(ordem).toEqual([
      'broker.removeQa',
      'broker.remove',
      'recursos.removendo',
      'projects.remove',
      'broker.removerOrfao',
    ]);
  });

  it('falha do broker não bloqueia o apagar', async () => {
    const { uc, ordem } = build({ brokerFalha: true });
    await expect(uc.execute('p')).resolves.toEqual({ id: 'p' });
    expect(ordem).toContain('projects.remove');
  });

  it('broker fora na hora de apagar: o projeto some e as linhas ficam `removendo` com o motivo (RN-1385)', async () => {
    const { uc, recursos } = build({ brokerFalha: true, orfaoFalha: true });
    await expect(uc.execute('p')).resolves.toEqual({ id: 'p' });
    expect(recursos.marcarRemovendoDoProjeto).toHaveBeenCalledWith('p');
    expect(recursos.concluirRemocaoDoProjeto).toHaveBeenCalledWith(
      'p',
      'broker fora',
    );
  });

  it('com o broker de pé, fecha as linhas como removidas', async () => {
    const { uc, recursos } = build();
    await uc.execute('p');
    expect(recursos.concluirRemocaoDoProjeto).toHaveBeenCalledWith('p', null);
  });

  it('modo runner não chama o broker', async () => {
    const { uc, remove, removerOrfao, recursos } = build({ modo: 'runner' });
    await uc.execute('p');
    expect(remove).not.toHaveBeenCalled();
    expect(removerOrfao).not.toHaveBeenCalled();
    expect(recursos.marcarRemovendoDoProjeto).not.toHaveBeenCalled();
  });

  it('projeto inexistente segue 404', async () => {
    const { uc } = build();
    (uc as never as { projects: { remove: () => unknown } }).projects.remove =
      () => Promise.resolve(null);
    await expect(uc.execute('p')).rejects.toBeInstanceOf(NotFoundException);
  });
});
