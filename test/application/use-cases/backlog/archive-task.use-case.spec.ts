import { describe, it, expect } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ArchiveTaskUseCase } from '../../../../src/application/use-cases/backlog/archive-task.use-case';

function build(opts: {
  status?: string;
  archivedAt?: Date | null;
  criadaPor?: string;
  arquivarDevolve?: 'ok' | 'null';
}) {
  const eventos: { type: string; payload: unknown; actor: unknown }[] = [];
  const tarefa = {
    id: 't1',
    storyId: 's1',
    title: 'fundação',
    status: opts.status ?? 'todo',
    assignedTo: 'dev-api',
    archivedAt: opts.archivedAt ?? null,
  };
  const useCase = new ArchiveTaskUseCase(
    {
      findById: () => Promise.resolve(tarefa),
      archive: () =>
        Promise.resolve(
          opts.arquivarDevolve === 'null'
            ? null
            : { ...tarefa, archivedAt: new Date() },
        ),
    } as never,
    {
      findById: () =>
        Promise.resolve({ id: 's1', projectId: 'p', sessionId: 'ss' }),
    } as never,
    {
      listByTypeForProject: () =>
        Promise.resolve([
          {
            payload: { taskId: 't1' },
            actor: { kind: 'agent', id: opts.criadaPor ?? 'dev_lead' },
          },
        ]),
    } as never,
    {
      execute: (_p: string, _s: string, e: never) => {
        eventos.push(e);
        return Promise.resolve({});
      },
    } as never,
    { runInTransaction: (w: () => Promise<unknown>) => w() } as never,
  );
  return { useCase, eventos };
}

const DONO = { kind: 'user', id: 'u1' } as const;
const DEVLEAD = { kind: 'agent', id: 'dev-lead' } as const;

describe('ArchiveTaskUseCase (AT-912, RN-1084)', () => {
  it('o dono arquiva a tarefa todo com motivo e grava backlog.task_archived', async () => {
    const { useCase, eventos } = build({ criadaPor: 'po' });
    await useCase.execute('p', 't1', ' duplicada ', DONO);
    expect(eventos).toEqual([
      expect.objectContaining({
        type: 'backlog.task_archived',
        actor: DONO,
        payload: {
          taskId: 't1',
          storyId: 's1',
          title: 'fundação',
          reason: 'duplicada',
        },
      }),
    ]);
  });

  it('motivo vazio: 400', async () => {
    const { useCase } = build({});
    await expect(useCase.execute('p', 't1', '  ', DONO)).rejects.toThrow(
      /motivo/,
    );
  });

  it('in_progress: 409 nomeado com o agente', async () => {
    const { useCase } = build({ status: 'in_progress' });
    await expect(useCase.execute('p', 't1', 'x', DONO)).rejects.toThrow(
      /dev-api/,
    );
  });

  it('já arquivada: 409', async () => {
    const { useCase } = build({ archivedAt: new Date() });
    await expect(useCase.execute('p', 't1', 'x', DONO)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('o Dev Lead arquiva a que ele criou, e recebe 409 na que o PO criou', async () => {
    await expect(
      build({ criadaPor: 'dev_lead' }).useCase.execute('p', 't1', 'x', DEVLEAD),
    ).resolves.toBeTruthy();
    await expect(
      build({ criadaPor: 'po' }).useCase.execute('p', 't1', 'x', DEVLEAD),
    ).rejects.toThrow(/ele mesmo criou/);
  });

  it('perdeu a corrida para o claim (archive devolve null): 409', async () => {
    const { useCase, eventos } = build({ arquivarDevolve: 'null' });
    await expect(useCase.execute('p', 't1', 'x', DONO)).rejects.toThrow(
      /acabou de ser pega/,
    );
    expect(eventos).toEqual([]);
  });
});
