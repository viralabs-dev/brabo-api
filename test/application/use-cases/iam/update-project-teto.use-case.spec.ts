import { describe, expect, it, vi } from 'vitest';
import { UpdateProjectUseCase } from '../../../../src/application/use-cases/iam/update-project.use-case';

const projetos = { update: () => Promise.resolve({ id: 'p1' }) } as never;

describe('UpdateProjectUseCase — teto por tarefa (RN-1155)', () => {
  it('mudar o teto chama o engine', async () => {
    const setTaskBudget = vi.fn().mockResolvedValue(undefined);
    const uc = new UpdateProjectUseCase(projetos, { setTaskBudget } as never);
    await uc.execute('p1', { taskBudgetMicros: 2_000_000 });
    expect(setTaskBudget).toHaveBeenCalledWith('p1', 2_000_000);
  });

  it('falha do engine não desfaz a mudança do projeto', async () => {
    const setTaskBudget = vi.fn().mockRejectedValue(new Error('engine fora'));
    const uc = new UpdateProjectUseCase(projetos, { setTaskBudget } as never);
    expect(await uc.execute('p1', { taskBudgetMicros: 2_000_000 })).toEqual({
      id: 'p1',
    });
  });

  it('sem teto no corpo, o engine não é chamado', async () => {
    const setTaskBudget = vi.fn();
    const uc = new UpdateProjectUseCase(projetos, { setTaskBudget } as never);
    await uc.execute('p1', {});
    expect(setTaskBudget).not.toHaveBeenCalled();
  });
});
