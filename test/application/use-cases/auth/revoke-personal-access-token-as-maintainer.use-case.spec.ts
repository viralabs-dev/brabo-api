import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokePersonalAccessTokenAsMaintainerUseCase } from '../../../../src/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

const RESUMO = {
  id: 'pat-1',
  name: 'laptop-do-outro',
  projectId: 'proj-1',
  createdAt: new Date(),
  expiresAt: null,
  revokedAt: new Date(),
  lastUsedAt: null,
};

function engineFake(
  disconnect: () => Promise<unknown> = () =>
    Promise.resolve({
      derrubados: 0,
      legados: 0,
      intocados: 0,
      semResposta: 0,
      ticketsAnulados: 0,
    }),
) {
  const disconnectRunnerCredential = vi.fn(disconnect);
  return {
    engine: { disconnectRunnerCredential } as unknown as ApiToEngineClient,
    disconnectRunnerCredential,
  };
}

describe('RevokePersonalAccessTokenAsMaintainerUseCase', () => {
  it('caminho feliz: revoga escopado ao PROJETO, não ao usuário chamador', async () => {
    const revogarComoMaintainer = vi.fn(() => Promise.resolve(RESUMO));
    const tokens = {
      revogarComoMaintainer,
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenAsMaintainerUseCase(
      tokens,
      engineFake().engine,
    );

    const resultado = await useCase.execute('pat-1', 'proj-1');

    expect(resultado).toBe(RESUMO);
    expect(revogarComoMaintainer).toHaveBeenCalledWith(
      'pat-1',
      'proj-1',
      'revoked_by_maintainer',
    );
  });

  it('repositório devolve null (não existe ou é de outro projeto): 404, e nada é derrubado', async () => {
    const tokens = {
      revogarComoMaintainer: vi.fn(() => Promise.resolve(null)),
    } as unknown as PersonalAccessTokenRepository;
    const { engine, disconnectRunnerCredential } = engineFake();
    const useCase = new RevokePersonalAccessTokenAsMaintainerUseCase(
      tokens,
      engine,
    );

    await expect(
      useCase.execute('pat-alheio', 'proj-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(disconnectRunnerCredential).not.toHaveBeenCalled();
  });

  it('ADR 0201 (RN-685): o runner já conectado com o token vazado cai — alvo o PAT', async () => {
    const tokens = {
      revogarComoMaintainer: vi.fn(() => Promise.resolve(RESUMO)),
    } as unknown as PersonalAccessTokenRepository;
    const { engine, disconnectRunnerCredential } = engineFake();

    await new RevokePersonalAccessTokenAsMaintainerUseCase(
      tokens,
      engine,
    ).execute('pat-1', 'proj-1');

    expect(disconnectRunnerCredential).toHaveBeenCalledWith(
      { tipo: 'pat', id: 'pat-1' },
      null,
    );
  });

  it('CASO DE FALHA: engine fora do ar não derruba a revogação', async () => {
    const tokens = {
      revogarComoMaintainer: vi.fn(() => Promise.resolve(RESUMO)),
    } as unknown as PersonalAccessTokenRepository;
    const { engine } = engineFake(() => Promise.reject(new Error('timeout')));

    await expect(
      new RevokePersonalAccessTokenAsMaintainerUseCase(tokens, engine).execute(
        'pat-1',
        'proj-1',
      ),
    ).resolves.toBe(RESUMO);
  });
});
