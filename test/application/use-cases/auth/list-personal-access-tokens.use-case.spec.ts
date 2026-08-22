import { describe, it, expect, vi } from 'vitest';
import { ListPersonalAccessTokensUseCase } from '../../../../src/application/use-cases/auth/list-personal-access-tokens.use-case';
import type { PersonalAccessTokenRepository } from '../../../../src/application/ports/personal-access-token-repository.port';

describe('ListPersonalAccessTokensUseCase', () => {
  it('delega ao repositório com userId e projectId, na ordem certa', async () => {
    const listarDoUsuarioNoProjeto = vi.fn(() => Promise.resolve([]));
    const tokens = {
      listarDoUsuarioNoProjeto,
    } as unknown as PersonalAccessTokenRepository;
    const useCase = new ListPersonalAccessTokensUseCase(tokens);

    await useCase.execute('user-1', 'proj-1');

    expect(listarDoUsuarioNoProjeto).toHaveBeenCalledWith('user-1', 'proj-1');
  });
});
