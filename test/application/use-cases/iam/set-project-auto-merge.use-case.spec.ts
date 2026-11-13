import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SetProjectAutoMergeUseCase } from '../../../../src/application/use-cases/iam/set-project-auto-merge.use-case';
import type { Role } from '../../../../src/domain/iam/role';

function montar(papel: Role | null, ligada = false, existe = true) {
  const update = vi.fn((_id: string, i: { mergeAutomatico: boolean }) =>
    Promise.resolve({ id: 'p1', ...i }),
  );
  const registrar = vi.fn().mockResolvedValue(undefined);
  const uc = new SetProjectAutoMergeUseCase(
    { runInTransaction: (f: () => unknown) => f() } as never,
    {
      findById: () =>
        Promise.resolve(existe ? { id: 'p1', mergeAutomatico: ligada } : null),
      update,
    } as never,
    { registrar },
    { forProject: () => Promise.resolve(papel) } as never,
  );
  return { uc, update, registrar };
}

describe('SetProjectAutoMergeUseCase (RN-1316)', () => {
  it('owner liga e grava o evento (quem, valor)', async () => {
    const { uc, update, registrar } = montar('owner');
    await uc.execute('p1', 'u1', true);
    expect(update).toHaveBeenCalledWith('p1', { mergeAutomatico: true });
    expect(registrar).toHaveBeenCalledWith({
      projectId: 'p1',
      userId: 'u1',
      habilitado: true,
    });
  });

  it('maintainer NÃO liga (403) e nada é gravado', async () => {
    const { uc, update, registrar } = montar('maintainer');
    await expect(uc.execute('p1', 'u1', true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('sem papel NÃO liga', async () => {
    await expect(
      montar(null).uc.execute('p1', 'u1', true),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('maintainer DESLIGA', async () => {
    const { uc, update, registrar } = montar('maintainer', true);
    await uc.execute('p1', 'u1', false);
    expect(update).toHaveBeenCalledWith('p1', { mergeAutomatico: false });
    expect(registrar).toHaveBeenCalledWith({
      projectId: 'p1',
      userId: 'u1',
      habilitado: false,
    });
  });

  it('repetir o valor atual não grava nada', async () => {
    const { uc, update, registrar } = montar('owner', true);
    await uc.execute('p1', 'u1', true);
    expect(update).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it('projeto inexistente é 404', async () => {
    await expect(
      montar('owner', false, false).uc.execute('p1', 'u1', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
