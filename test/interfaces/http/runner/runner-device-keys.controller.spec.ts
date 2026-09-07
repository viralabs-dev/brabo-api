import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { RunnerDeviceKeysController } from '../../../../src/interfaces/http/runner/runner-device-keys.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { User } from '../../../../src/domain/iam/user.entity';

const user = { id: 'user-1' } as User;

function controller() {
  const register = { execute: vi.fn() };
  const list = { execute: vi.fn() };
  const revoke = { execute: vi.fn() };
  return {
    controller: new RunnerDeviceKeysController(
      register as never,
      list as never,
      revoke as never,
    ),
    register,
    list,
    revoke,
  };
}

describe('RunnerDeviceKeysController', () => {
  it('as TRÊS rotas exigem developer — mesma régua de runner-ticket e do PAT', () => {
    const reflector = new Reflector();
    for (const handler of [
      RunnerDeviceKeysController.prototype.registerDeviceKey,
      RunnerDeviceKeysController.prototype.listDeviceKeys,
      RunnerDeviceKeysController.prototype.revokeDeviceKey,
    ]) {
      expect(reflector.get(REQUIRED_ROLE_KEY, handler)).toBe('developer');
    }
  });

  it('revokeDeviceKey continua 204 depois de passar a derrubar a conexão viva (RN-520)', () => {
    expect(
      new Reflector().get(
        HTTP_CODE_METADATA,
        RunnerDeviceKeysController.prototype.revokeDeviceKey,
      ),
    ).toBe(204);
  });

  it('listDeviceKeys (RN-519): delega ao use case com userId do CurrentUser e projectId da rota', async () => {
    const { controller: c, list } = controller();
    list.execute.mockResolvedValue([]);

    await c.listDeviceKeys('proj-1', user);

    expect(list.execute).toHaveBeenCalledWith('user-1', 'proj-1');
  });

  it('listDeviceKeys devolve o que o use case devolveu, sem filtrar revogada', async () => {
    const { controller: c, list } = controller();
    const linhas = [
      { id: 'a', revokedAt: null },
      { id: 'b', revokedAt: new Date() },
    ];
    list.execute.mockResolvedValue(linhas);

    await expect(c.listDeviceKeys('proj-1', user)).resolves.toBe(linhas);
  });

  it('CASO DE FALHA: use case que rejeita propaga — a rota não devolve lista vazia por engano', async () => {
    const { controller: c, list } = controller();
    list.execute.mockRejectedValue(new Error('banco fora do ar'));

    await expect(c.listDeviceKeys('proj-1', user)).rejects.toThrow(
      'banco fora do ar',
    );
  });

  it('revokeDeviceKey: delega com deviceKeyId e userId — nunca com o projectId da URL', async () => {
    const { controller: c, revoke } = controller();
    revoke.execute.mockResolvedValue(undefined);

    await c.revokeDeviceKey('proj-da-url', 'device-1', user);

    expect(revoke.execute).toHaveBeenCalledWith('device-1', 'user-1');
  });
});
