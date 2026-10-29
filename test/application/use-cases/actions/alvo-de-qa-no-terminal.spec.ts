import { describe, expect, it } from 'vitest';
import { ExecuteTerminalActionUseCase } from '../../../../src/application/use-cases/actions/execute-terminal-action.use-case';
import type { InstanciaDeQaUseCase } from '../../../../src/application/use-cases/containers/instancia-de-qa.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const TASK = 'a1b2c3d4-0000-4000-8000-000000000001';

function montar(tarefaDoProjeto: boolean) {
  const qa = {
    resolverTarefa: (_p: string, ref: string) =>
      tarefaDoProjeto ? Promise.resolve(ref) : Promise.reject(new Error('404')),
  } as unknown as InstanciaDeQaUseCase;
  const uc = new ExecuteTerminalActionUseCase(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    qa,
  );
  return (id: string, alvo: unknown) =>
    (
      uc as unknown as {
        alvoDeQa(p: string, a: ProposedAction): Promise<unknown>;
      }
    ).alvoDeQa('p1', {
      id: 'a1',
      actor: { kind: 'agent', id },
      payload: { command: 'npm test', alvo },
    } as unknown as ProposedAction);
}

describe('alvo de QA no terminal (AT-612, RN-938)', () => {
  const alvo = { qa: true, taskId: TASK };

  it('qa-automacao com tarefa do projeto: repassa', async () => {
    expect(await montar(true)('qa-automacao', alvo)).toEqual(alvo);
  });

  it('outro agente com alvo no payload: descarta', async () => {
    expect(await montar(true)('dev-api', alvo)).toBeUndefined();
  });

  it('qa-automacao com tarefa de outro projeto: descarta', async () => {
    expect(await montar(false)('qa-automacao', alvo)).toBeUndefined();
  });

  it('sem alvo: nada a repassar', async () => {
    expect(await montar(true)('qa-automacao', undefined)).toBeUndefined();
  });
});
