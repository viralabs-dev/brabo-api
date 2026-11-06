import { describe, it, expect } from 'vitest';
import { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';

const MERGE = {
  id: 'm',
  actionType: 'git_merge',
  status: 'pending',
  actor: { kind: 'agent', id: 'dev' },
  payload: { pullRequestId: 'pr-2' },
  executionResult: null,
};

function build(propor: unknown) {
  const executada = { ...MERGE, status: 'executed' };
  const args: unknown[] = new Array(21).fill(undefined);
  args[0] = { runInTransaction: (fn: () => unknown) => Promise.resolve(fn()) };
  args[1] = { findInProject: () => Promise.resolve({ id: 's' }) };
  args[2] = {
    findInSessionForUpdate: () => Promise.resolve(MERGE),
    listByProjectAndType: () => Promise.resolve([]),
    updateDecision: () => Promise.resolve({ ...MERGE, status: 'approved' }),
  };
  args[3] = { append: () => Promise.resolve() };
  args[11] = { execute: () => Promise.resolve(executada) }; // executeGitAction
  args[15] = { actionsDecided: { inc: () => undefined } }; // metrics
  args[16] = { execute: () => Promise.resolve() }; // appendSessionEvent
  args[20] = propor;
  const uc = new ApproveActionUseCase(
    ...(args as ConstructorParameters<typeof ApproveActionUseCase>),
  );
  return { uc, executada };
}

describe('gancho do approve (AT-758, RN-1029)', () => {
  it('chama a proposta depois do merge, com a ação já executada', async () => {
    const vistos: unknown[] = [];
    const { uc, executada } = build({
      execute: (_p: string, _s: string, a: unknown) => {
        vistos.push(a);
        return Promise.resolve(null);
      },
    });
    await uc.execute('p', 's', 'm', 'u1');
    expect(vistos).toEqual([executada]);
  });

  it('a falha do gancho não desfaz o merge: devolve a ação executada', async () => {
    const { uc } = build({
      execute: () => Promise.reject(new Error('token=segredo')),
    });
    const r = await uc.execute('p', 's', 'm', 'u1');
    expect(r.status).toBe('executed');
  });
});
