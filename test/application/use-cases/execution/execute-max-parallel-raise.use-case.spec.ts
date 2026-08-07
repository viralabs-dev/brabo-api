import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecuteMaxParallelRaiseUseCase } from '../../../../src/application/use-cases/execution/execute-max-parallel-raise.use-case';
import type { SetAreaMaxParallelUseCase } from '../../../../src/application/use-cases/execution/set-area-max-parallel.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeSet {
  chamadas: { key: string; valor: number }[] = [];
  execute(_p: string, key: string, valor: number) {
    this.chamadas.push({ key, valor });
    return Promise.resolve({} as never);
  }
}

function acao(payload: unknown): ProposedAction {
  return {
    id: 'act-9',
    projectId: PROJECT,
    sessionId: SESSION,
    actionType: 'raise_max_parallel',
    payload,
    status: 'approved',
    actor: { kind: 'agent', id: 'anamnese' },
    decidedBy: 'user-1',
  } as ProposedAction;
}

let set: FakeSet;
let uc: ExecuteMaxParallelRaiseUseCase;

beforeEach(() => {
  set = new FakeSet();
  uc = new ExecuteMaxParallelRaiseUseCase(
    set as unknown as SetAreaMaxParallelUseCase,
  );
});

describe('ExecuteMaxParallelRaiseUseCase', () => {
  it('aprovar aplica o teto proposto', async () => {
    await uc.execute(PROJECT, SESSION, acao({ area: 'dev', proposto: 4 }));

    expect(set.chamadas).toEqual([{ key: 'dev', valor: 4 }]);
  });

  it('aplica o valor do PAYLOAD, que é o que o usuário leu', async () => {
    // Recalcular agora poderia aplicar um teto diferente do autorizado.
    await uc.execute(PROJECT, SESSION, acao({ area: 'qa', proposto: 7 }));

    expect(set.chamadas[0]).toEqual({ key: 'qa', valor: 7 });
  });

  it('payload incompleto NÃO derruba a aprovação, e registra o erro', async () => {
    const erro = vi.spyOn(
      (uc as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    );

    const devolvida = await uc.execute(PROJECT, SESSION, acao({ area: 'dev' }));

    expect(set.chamadas).toHaveLength(0);
    expect(devolvida.id).toBe('act-9');
    expect(erro).toHaveBeenCalled();
  });
});
