import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ExecuteQaEnvironmentStartUseCase } from '../../../../src/application/use-cases/actions/execute-qa-environment-start.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

function build(start: () => Promise<unknown>) {
  const gravados: {
    status: string;
    executionResult: Record<string, unknown>;
  }[] = [];
  const uow = { runInTransaction: <T>(fn: () => Promise<T>) => fn() };
  const proposed = {
    updateExecutionResult: (_id: string, r: (typeof gravados)[number]) => {
      gravados.push(r);
      return Promise.resolve(r);
    },
  };
  const uc = new ExecuteQaEnvironmentStartUseCase(
    uow,
    proposed as never,
    { execute: vi.fn().mockResolvedValue(undefined) } as never,
    { append: vi.fn().mockResolvedValue(undefined) } as never,
    { start } as never,
  );
  return { uc, gravados };
}

const acao = {
  id: 'pa-1',
  payload: { taskId: 't-1' },
} as unknown as ProposedAction;

describe('ExecuteQaEnvironmentStartUseCase (AT-1017)', () => {
  it('teto ocupado vira failed com codigo instancia_de_qa_ocupada', async () => {
    const { uc, gravados } = build(() =>
      Promise.reject(
        new ConflictException({
          code: 'instancia_de_qa_ocupada',
          message: 'O projeto já tem uma instância de QA ativa (teto de 1).',
        }),
      ),
    );
    await uc.execute('p', 's', acao);
    expect(gravados[0].status).toBe('failed');
    expect(gravados[0].executionResult.codigo).toBe('instancia_de_qa_ocupada');
    expect(gravados[0].executionResult.motivo).toContain('teto de 1');
  });

  it('falha do broker vira failed sem codigo', async () => {
    const { uc, gravados } = build(() =>
      Promise.resolve({ sucesso: false, motivo: 'broker recusou', chave: 'k' }),
    );
    await uc.execute('p', 's', acao);
    expect(gravados[0].status).toBe('failed');
    expect(gravados[0].executionResult).not.toHaveProperty('codigo');
  });

  it('subida ok vira executed sem codigo', async () => {
    const { uc, gravados } = build(() =>
      Promise.resolve({ sucesso: true, motivo: null, chave: 'k' }),
    );
    await uc.execute('p', 's', acao);
    expect(gravados[0].status).toBe('executed');
    expect(gravados[0].executionResult).not.toHaveProperty('codigo');
  });
});
