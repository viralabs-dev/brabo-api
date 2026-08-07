import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExecuteParallelizationUseCase } from '../../../../src/application/use-cases/execution/execute-parallelization.use-case';
import type { AcceptParallelizationUseCase } from '../../../../src/application/use-cases/execution/accept-parallelization.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeAccept {
  chamadas: { module: string; userId: string }[] = [];
  execute(_p: string, _s: string, module: string, userId: string) {
    this.chamadas.push({ module, userId });
    return Promise.resolve({ ok: true as const });
  }
}

function acao(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'act-1',
    projectId: PROJECT,
    sessionId: SESSION,
    seq: 1,
    actionType: 'parallelize',
    payload: { module: 'api' },
    status: 'approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-lead' },
    decidedBy: 'user-1',
    decidedAt: new Date(),
    rejectionReason: null,
    ...over,
  } as ProposedAction;
}

let accept: FakeAccept;
let uc: ExecuteParallelizationUseCase;

beforeEach(() => {
  accept = new FakeAccept();
  uc = new ExecuteParallelizationUseCase(
    accept as unknown as AcceptParallelizationUseCase,
  );
});

describe('ExecuteParallelizationUseCase', () => {
  it('aprovar SOBE o agente do módulo autorizado', async () => {
    // O ponto da peça inteira. Sem ela a ação era aprovada e nada subia — pior
    // que não ter a feature, porque a tela afirma que o usuário autorizou.
    await uc.execute(PROJECT, SESSION, acao());

    expect(accept.chamadas).toEqual([{ module: 'api', userId: 'user-1' }]);
  });

  it('sobe o módulo do PAYLOAD, que é o que o usuário leu ao decidir', async () => {
    // O payload é imutável. Reconsultar o estado agora poderia subir um agente
    // para um módulo diferente do autorizado.
    await uc.execute(PROJECT, SESSION, acao({ payload: { module: 'web' } }));

    expect(accept.chamadas[0]!.module).toBe('web');
  });

  it('quem consta é QUEM DECIDIU, não o lead que pediu', async () => {
    await uc.execute(
      PROJECT,
      SESSION,
      acao({ decidedBy: 'user-42', actor: { kind: 'agent', id: 'dev-lead' } }),
    );

    expect(accept.chamadas[0]!.userId).toBe('user-42');
  });

  it('payload sem módulo NÃO derruba a aprovação, e registra o erro', async () => {
    // A decisão do usuário já está gravada e é imutável. O que se perde é a
    // execução, e ela tem de aparecer como falha explícita — não como agente
    // que silenciosamente não subiu.
    const erro = vi.spyOn(
      (uc as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    );

    const devolvida = await uc.execute(PROJECT, SESSION, acao({ payload: {} }));

    expect(accept.chamadas).toHaveLength(0);
    expect(devolvida.id).toBe('act-1');
    expect(erro).toHaveBeenCalled();
  });
});
