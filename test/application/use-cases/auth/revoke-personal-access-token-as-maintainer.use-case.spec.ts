import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokePersonalAccessTokenAsMaintainerUseCase } from '../../../../src/application/use-cases/auth/revoke-personal-access-token-as-maintainer.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';

const RESUMO = {
  id: 'pat-1',
  name: 'laptop-do-outro',
  projectId: 'proj-1',
  createdAt: new Date(),
  expiresAt: null,
  revokedAt: new Date(),
  lastUsedAt: null,
};

describe('RevokePersonalAccessTokenAsMaintainerUseCase', () => {
  it('caminho feliz: revoga escopado ao PROJETO, não ao usuário chamador', async () => {
    const revogarComoMaintainer = vi.fn(() => Promise.resolve(RESUMO));
    const tokens = {
      revogarComoMaintainer,
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenAsMaintainerUseCase(tokens);

    const resultado = await useCase.execute('pat-1', 'proj-1');

    expect(resultado).toBe(RESUMO);
    expect(revogarComoMaintainer).toHaveBeenCalledWith(
      'pat-1',
      'proj-1',
      'revoked_by_maintainer',
    );
  });

  it('repositório devolve null (não existe ou é de outro projeto): 404', async () => {
    const tokens = {
      revogarComoMaintainer: vi.fn(() => Promise.resolve(null)),
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new RevokePersonalAccessTokenAsMaintainerUseCase(tokens);

    await expect(
      useCase.execute('pat-alheio', 'proj-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
