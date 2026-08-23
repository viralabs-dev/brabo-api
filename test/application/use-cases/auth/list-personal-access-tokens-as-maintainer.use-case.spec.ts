import { describe, it, expect, vi } from 'vitest';
import { ListPersonalAccessTokensAsMaintainerUseCase } from '../../../../src/application/use-cases/auth/list-personal-access-tokens-as-maintainer.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';

describe('ListPersonalAccessTokensAsMaintainerUseCase', () => {
  it('delega ao repositório só com projectId — nunca escopado a um usuário', async () => {
    const listarDoProjeto = vi.fn(() => Promise.resolve([]));
    const tokens = {
      listarDoProjeto,
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new ListPersonalAccessTokensAsMaintainerUseCase(tokens);

    await useCase.execute('proj-1');

    expect(listarDoProjeto).toHaveBeenCalledWith('proj-1');
  });
});
