import { describe, it, expect } from 'vitest';
import { MarkTaskUseCase } from '../../../../src/application/use-cases/execution/mark-task.use-case';

function build(modules: Array<{ name: string; dependsOn: string[] }>) {
  const outbox: unknown[] = [];
  const useCase = new MarkTaskUseCase(
    { updateStatus: (id: string) => Promise.resolve({ id }) } as never,
    { execute: () => Promise.resolve({}) } as never,
    { findCurrent: () => Promise.resolve({ modules }) } as never,
    {
      append: (l: unknown) => {
        outbox.push(l);
        return Promise.resolve();
      },
    } as never,
    { runInTransaction: (w: () => Promise<unknown>) => w() } as never,
  );
  return { useCase, outbox };
}

const MAPA = [
  { name: 'db', dependsOn: [] },
  { name: 'api', dependsOn: ['db'] },
];

describe('MarkTaskUseCase — wake dos dependentes (AT-906, RN-NOVA-1)', () => {
  it('done grava task.became_claimable com os módulos que têm dependsOn', async () => {
    const { useCase, outbox } = build(MAPA);
    await useCase.execute('p', 's', 't1', 'done', 'dev-db');
    expect(outbox).toEqual([
      {
        aggregateType: 'task',
        aggregateId: 't1',
        eventType: 'task.became_claimable',
        payload: {
          projectId: 'p',
          sessionId: 's',
          taskId: 't1',
          modules: ['api'],
          cause: 'dependency_done',
        },
      },
    ]);
  });

  it('outro status não grava', async () => {
    const { useCase, outbox } = build(MAPA);
    await useCase.execute('p', 's', 't1', 'in_review', 'dev-db');
    expect(outbox).toEqual([]);
  });

  it('done sem dependsOn no mapa não grava', async () => {
    const { useCase, outbox } = build([{ name: 'db', dependsOn: [] }]);
    await useCase.execute('p', 's', 't1', 'done', 'dev-db');
    expect(outbox).toEqual([]);
  });
});
