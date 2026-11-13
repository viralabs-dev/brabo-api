import { describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { OutboxRepository } from '../../../src/application/ports/outbox-repository.port';
import type { IndexProjectDocsUseCase } from '../../../src/application/use-cases/rag/index-project-docs.use-case';
import type { OutboxEvent } from '../../../src/domain/shared/outbox-event.entity';
import { TrunkMergedReindexer } from '../../../src/application/rag-reindex/trunk-merged-reindexer';

function linha(id: string, projeto: string, t: number): OutboxEvent {
  return {
    id,
    aggregateType: 'project',
    aggregateId: projeto,
    eventType: 'project.trunk_merged',
    payload: {},
    createdAt: new Date(t),
    processedAt: null,
  };
}

function montar(rows: OutboxEvent[], execute = vi.fn().mockResolvedValue({})) {
  const listByEventTypeAfter = vi.fn().mockResolvedValue(rows);
  const markProcessed = vi.fn();
  const r = new TrunkMergedReindexer(
    { listByEventTypeAfter, markProcessed } as unknown as OutboxRepository,
    { execute } as unknown as IndexProjectDocsUseCase,
  );
  return { r, execute, listByEventTypeAfter, markProcessed };
}

describe('TrunkMergedReindexer (RN-1108)', () => {
  it('reindexa cada projeto uma vez e nunca marca a linha como processada', async () => {
    const { r, execute, markProcessed } = montar([
      linha('1', 'p1', 1),
      linha('2', 'p1', 2),
      linha('3', 'p2', 3),
    ]);
    await r.drainOnce();
    expect(execute.mock.calls).toEqual([['p1'], ['p2']]);
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('avança a marca d’água para não reindexar o mesmo merge', async () => {
    const { r, listByEventTypeAfter } = montar([linha('1', 'p1', 5000)]);
    await r.drainOnce();
    await r.drainOnce();
    expect(listByEventTypeAfter.mock.calls[1][1]).toEqual(new Date(5000));
  });

  it('falha na reindexação só loga e segue para o próximo projeto', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({});
    const { r } = montar([linha('1', 'p1', 1), linha('2', 'p2', 2)], execute);
    await expect(r.drainOnce()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
