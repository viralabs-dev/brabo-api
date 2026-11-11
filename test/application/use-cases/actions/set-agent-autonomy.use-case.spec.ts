import { describe, it, expect } from 'vitest';
import { SetAgentAutonomyUseCase } from '../../../../src/application/use-cases/actions/set-agent-autonomy.use-case';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { AgentAutonomyRepository } from '../../../../src/application/ports/agent-autonomy-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import type { ApproveActionUseCase } from '../../../../src/application/use-cases/actions/approve-action.use-case';

const pendente = (id: string, actionType: string, agent = 'dev-x-2') => ({
  id,
  sessionId: 's1',
  actionType,
  payload: {},
  actor: { kind: 'agent', id: agent },
});

function build(pendentes: ReturnType<typeof pendente>[]) {
  const upserts: string[][] = [];
  const aprovadas: string[][] = [];
  const useCase = new SetAgentAutonomyUseCase(
    {
      findById: () => Promise.resolve({ id: 'p1' }),
    } as unknown as ProjectRepository,
    {
      upsert: (_p: string, a: string, t: string, m: string) => {
        upserts.push([a, t, m]);
        return Promise.resolve();
      },
    } as unknown as AgentAutonomyRepository,
    {
      findPendingByProject: () => Promise.resolve(pendentes),
    } as unknown as ProposedActionRepository,
    {
      findInProject: () => Promise.resolve({ createdBy: 'u1' }),
    } as unknown as SessionRepository,
    {
      // Os tetos continuam pedindo decisão: só o terminal vira auto.
      decidir: (_p: unknown, _c: string, tipo: string) =>
        Promise.resolve({
          policy: tipo === 'terminal' ? 'auto_approve' : 'require_approval',
        }),
    } as unknown as ProposeActionUseCase,
    {
      execute: (_p: string, _s: string, id: string, por: string) => {
        aprovadas.push([id, por]);
        return Promise.resolve({});
      },
    } as unknown as ApproveActionUseCase,
  );
  return { useCase, upserts, aprovadas };
}

describe('SetAgentAutonomyUseCase — RN-1103', () => {
  it('ligar a curinga libera o terminal pendente e mantém o git_push', async () => {
    const { useCase, upserts, aprovadas } = build([
      pendente('a1', 'terminal'),
      pendente('a2', 'git_push'),
      pendente('a3', 'terminal', 'outro-agente'),
    ]);
    await useCase.execute('p1', 'dev-x-2', '*', 'auto_approve', 'u1');
    expect(upserts).toEqual([['dev-x-2', '*', 'auto_approve']]);
    expect(aprovadas).toEqual([['a1', 'u1']]);
  });

  it('regra específica ou modo manual não reavalia nada', async () => {
    const { useCase, aprovadas } = build([pendente('a1', 'terminal')]);
    await useCase.execute('p1', 'dev-x-2', 'terminal', 'auto_approve', 'u1');
    await useCase.execute('p1', 'dev-x-2', '*', 'require_approval', 'u1');
    expect(aprovadas).toEqual([]);
  });
});
