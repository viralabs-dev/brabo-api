import { describe, expect, it, vi } from 'vitest';
import { RecordSourceClickUseCase } from '../../../../src/application/use-cases/rag/record-source-click.use-case';
import { SourceClicksController } from '../../../../src/interfaces/http/rag/source-clicks.controller';
import type { RagTelemetryRepository } from '../../../../src/application/ports/rag-telemetry-repository.port';
import type { User } from '../../../../src/domain/iam/user.entity';

const ENTRADA = {
  projectId: 'p1',
  sessionId: 's1',
  eventId: 'e1',
  tipo: 'rag',
  ref: null,
  searchId: 'q1',
  chunkId: 'c1',
  userId: 'u1',
};

describe('RecordSourceClickUseCase (RN-983)', () => {
  it('grava a linha congelada e devolve o id', async () => {
    const recordSourceClick = vi.fn().mockResolvedValue({ id: 'k1' });
    const uc = new RecordSourceClickUseCase({
      recordSourceClick,
    } as unknown as RagTelemetryRepository);
    expect(await uc.execute(ENTRADA)).toEqual({ id: 'k1' });
    expect(recordSourceClick).toHaveBeenCalledWith(ENTRADA);
  });

  it('CASO DE FALHA: erro de gravação devolve null e não lança', async () => {
    const uc = new RecordSourceClickUseCase({
      recordSourceClick: vi.fn().mockRejectedValue(new Error('banco fora')),
    } as unknown as RagTelemetryRepository);
    expect(await uc.execute(ENTRADA)).toBeNull();
  });

  it('o controller usa o usuário autenticado, nunca o corpo', async () => {
    const execute = vi.fn().mockResolvedValue({ id: 'k1' });
    const c = new SourceClicksController({ execute } as never);
    await c.registrar('p1', { eventId: 'e1', tipo: 'historia', ref: 'st-1' }, {
      id: 'u9',
    } as User);
    expect(execute).toHaveBeenCalledWith({
      projectId: 'p1',
      sessionId: null,
      eventId: 'e1',
      tipo: 'historia',
      ref: 'st-1',
      searchId: null,
      chunkId: null,
      userId: 'u9',
    });
  });
});
