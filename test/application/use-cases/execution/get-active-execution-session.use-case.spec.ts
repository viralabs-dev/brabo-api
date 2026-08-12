import { describe, it, expect } from 'vitest';
import { GetActiveExecutionSessionUseCase } from '../../../../src/application/use-cases/execution/get-active-execution-session.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { Session } from '../../../../src/domain/sessions/session.entity';

function build(sessao: Session | null) {
  const chamadas: string[] = [];
  const sessions = {
    findActiveExecutionSession: (projectId: string) => {
      chamadas.push(projectId);
      return Promise.resolve(sessao);
    },
  } as unknown as SessionRepository;

  return { useCase: new GetActiveExecutionSessionUseCase(sessions), chamadas };
}

const SESSAO: Session = {
  id: 'sess-exec-1',
  projectId: 'proj-1',
  createdBy: 'user-1',
  status: 'active',
  kind: 'criativa',
  name: null,
  nextSeq: 12,
  createdAt: new Date('2026-08-10T10:00:00.000Z'),
  updatedAt: new Date('2026-08-10T10:05:00.000Z'),
  closedAt: null,
  terminationReason: null,
  traceParent: null,
};

describe('GetActiveExecutionSessionUseCase (RN-136)', () => {
  it('devolve a sessão de execução vigente do projeto, delegando ao MESMO critério que a ativação usa', async () => {
    const { useCase, chamadas } = build(SESSAO);

    await expect(useCase.execute('proj-1')).resolves.toEqual(SESSAO);
    // `findActiveExecutionSession` é o critério — active + execution.activated
    // gravado — e não uma reimplementação aqui: nenhuma lógica própria de
    // "mais recente" nasce nesta classe.
    expect(chamadas).toEqual(['proj-1']);
  });

  it('sem execução ativa, devolve null — nunca lança, nunca inventa uma sessão', async () => {
    const { useCase } = build(null);

    await expect(useCase.execute('proj-1')).resolves.toBeNull();
  });
});
