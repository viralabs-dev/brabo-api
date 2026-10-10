import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { GetSessionContextSummaryUseCase } from '../../../../src/application/use-cases/sessions/get-session-context-summary.use-case';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';

describe('GetSessionContextSummaryUseCase (RN-827)', () => {
  const resumo = {
    sessoesLidas: ['s1'],
    regras: 11,
    decisoes: 6,
    artefatosPorAgente: [],
    arquivosTocados: { itens: [], total: 0 },
  };

  it('devolve o agregado da sessão do projeto', async () => {
    const sessions = { findInProject: vi.fn().mockResolvedValue({ id: 's1' }) };
    const repo = { resumir: vi.fn().mockResolvedValue(resumo) };
    const uc = new GetSessionContextSummaryUseCase(
      sessions as unknown as SessionRepository,
      repo,
    );
    await expect(uc.execute('p1', 's1')).resolves.toEqual(resumo);
    expect(repo.resumir).toHaveBeenCalledWith('p1', 's1');
  });

  it('sessão de outro projeto é 404 e não lê nada', async () => {
    const sessions = { findInProject: vi.fn().mockResolvedValue(null) };
    const repo = { resumir: vi.fn() };
    const uc = new GetSessionContextSummaryUseCase(
      sessions as unknown as SessionRepository,
      repo,
    );
    await expect(uc.execute('p1', 'sX')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.resumir).not.toHaveBeenCalled();
  });
});
