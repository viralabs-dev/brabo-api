import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokePersonalAccessTokenUseCase } from '../../../../src/application/use-cases/auth/revoke-personal-access-token.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';

const RESUMO = {
  id: 'pat-1',
  name: 'laptop',
  projectId: 'proj-1',
  createdAt: new Date(),
  expiresAt: null,
  revokedAt: new Date(),
  lastUsedAt: null,
};

describe('RevokePersonalAccessTokenUseCase', () => {
  it('caminho feliz: revoga e devolve o resumo', async () => {
    const revogar = vi.fn(() => Promise.resolve(RESUMO));
    const tokens = { revogar } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenUseCase(tokens);

    const resultado = await useCase.execute('pat-1', 'user-1');

    expect(resultado).toBe(RESUMO);
    expect(revogar).toHaveBeenCalledWith('pat-1', 'user-1', 'user_requested');
  });

  it('repositório devolve null (não existe ou não é do usuário): 404', async () => {
    const tokens = {
      revogar: vi.fn(() => Promise.resolve(null)),
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenUseCase(tokens);

    await expect(
      useCase.execute('pat-alheio', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
