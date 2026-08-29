import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokeRunnerDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/revoke-runner-device-key.use-case';
import type { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';

const RESUMO = {
  id: 'device-1',
  name: 'laptop',
  projectId: 'proj-1',
  createdAt: new Date(),
  revokedAt: new Date(),
  lastUsedAt: null,
};

describe('RevokeRunnerDeviceKeyUseCase', () => {
  it('caminho feliz: revoga e devolve o resumo', async () => {
    const revogar = vi.fn(() => Promise.resolve(RESUMO));
    const deviceKeys = { revogar } as unknown as RunnerDeviceKeyRepository;
    const useCase = new RevokeRunnerDeviceKeyUseCase(deviceKeys);

    const resultado = await useCase.execute('device-1', 'user-1');

    expect(resultado).toBe(RESUMO);
    expect(revogar).toHaveBeenCalledWith(
      'device-1',
      'user-1',
      'user_requested',
    );
  });

  it('repositório devolve null (não existe ou não é do usuário): 404', async () => {
    const deviceKeys = {
      revogar: vi.fn(() => Promise.resolve(null)),
    } as unknown as RunnerDeviceKeyRepository;
    const useCase = new RevokeRunnerDeviceKeyUseCase(deviceKeys);

    await expect(
      useCase.execute('device-alheio', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
