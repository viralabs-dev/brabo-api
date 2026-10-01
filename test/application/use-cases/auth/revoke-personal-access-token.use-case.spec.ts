import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokePersonalAccessTokenUseCase } from '../../../../src/application/use-cases/auth/revoke-personal-access-token.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

const RESUMO = {
  id: 'pat-1',
  name: 'laptop',
  projectId: 'proj-1',
  createdAt: new Date(),
  expiresAt: null,
  revokedAt: new Date(),
  lastUsedAt: null,
};

function engineFake(
  disconnect: () => Promise<unknown> = () =>
    Promise.resolve({
      derrubados: 1,
      legados: 0,
      intocados: 0,
      semResposta: 0,
      ticketsAnulados: 0,
    }),
) {
  const disconnectRunnerCredential = vi.fn(disconnect);
  const disconnectRunnerOfUser = vi.fn();
  return {
    engine: {
      disconnectRunnerCredential,
      disconnectRunnerOfUser,
    } as unknown as ApiToEngineClient,
    disconnectRunnerCredential,
    disconnectRunnerOfUser,
  };
}

describe('RevokePersonalAccessTokenUseCase', () => {
  it('caminho feliz: revoga e devolve o resumo', async () => {
    const revogar = vi.fn(() => Promise.resolve(RESUMO));
    const tokens = { revogar } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenUseCase(
      tokens,
      engineFake().engine,
    );

    const resultado = await useCase.execute('pat-1', 'user-1');

    expect(resultado).toBe(RESUMO);
    expect(revogar).toHaveBeenCalledWith('pat-1', 'user-1', 'user_requested');
  });

  it('repositório devolve null (não existe ou não é do usuário): 404, e nada é derrubado', async () => {
    const tokens = {
      revogar: vi.fn(() => Promise.resolve(null)),
    } as unknown as PersonalAccessTokenRepository;
    const { engine, disconnectRunnerCredential } = engineFake();
    const useCase = new RevokePersonalAccessTokenUseCase(tokens, engine);

    await expect(
      useCase.execute('pat-alheio', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(disconnectRunnerCredential).not.toHaveBeenCalled();
  });

  describe('a revogação alcança as conexões DESTE token (ADR 0201, RN-685)', () => {
    it('derruba pelo PAT, sem alcance legado — nunca pelo par {projeto, usuário}', async () => {
      const tokens = {
        revogar: vi.fn(() => Promise.resolve(RESUMO)),
      } as unknown as PersonalAccessTokenRepository;
      const { engine, disconnectRunnerCredential, disconnectRunnerOfUser } =
        engineFake();

      await new RevokePersonalAccessTokenUseCase(tokens, engine).execute(
        'pat-1',
        'user-1',
      );

      expect(disconnectRunnerCredential).toHaveBeenCalledWith(
        { tipo: 'pat', id: 'pat-1' },
        null,
      );
      expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
    });

    it('CASO DE FALHA: engine fora do ar não derruba a revogação nem vira exceção', async () => {
      const tokens = {
        revogar: vi.fn(() => Promise.resolve(RESUMO)),
      } as unknown as PersonalAccessTokenRepository;
      const { engine } = engineFake(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      );

      await expect(
        new RevokePersonalAccessTokenUseCase(tokens, engine).execute(
          'pat-1',
          'user-1',
        ),
      ).resolves.toBe(RESUMO);
    });
  });
});
