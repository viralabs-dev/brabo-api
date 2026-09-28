import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { MachineDeviceKeysController } from '../../../../src/interfaces/http/runner/machine-device-keys.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { User } from '../../../../src/domain/iam/user.entity';

/* eslint-disable @typescript-eslint/unbound-method */

const user = { id: 'user-1' } as User;

function controller() {
  const list = { execute: vi.fn() };
  const revoke = { execute: vi.fn() };
  return {
    controller: new MachineDeviceKeysController(list as never, revoke as never),
    list,
    revoke,
  };
}

describe('MachineDeviceKeysController (RN-611)', () => {
  it('nenhuma das duas rotas tem @RequireRole — o escopo é o PRÓPRIO usuário, como users/me/credentials', () => {
    const reflector = new Reflector();
    for (const handler of [
      MachineDeviceKeysController.prototype.listMachineDeviceKeys,
      MachineDeviceKeysController.prototype.revokeMachineDeviceKey,
    ]) {
      expect(reflector.get(REQUIRED_ROLE_KEY, handler)).toBeUndefined();
    }
  });

  it('revogar é 204, sem corpo — mesmo padrão da rota por projeto', () => {
    expect(
      new Reflector().get(
        HTTP_CODE_METADATA,
        MachineDeviceKeysController.prototype.revokeMachineDeviceKey,
      ),
    ).toBe(204);
  });

  it('lista com o userId do JWT e nada mais — não há parâmetro que peça as chaves de outra pessoa', async () => {
    const { controller: c, list } = controller();
    const linhas = [
      { id: 'a', especie: 'maquina', revokedAt: null },
      { id: 'b', especie: 'maquina', revokedAt: new Date() },
    ];
    list.execute.mockResolvedValue(linhas);

    await expect(c.listMachineDeviceKeys(user)).resolves.toBe(linhas);
    expect(list.execute).toHaveBeenCalledWith('user-1');
  });

  it('revoga com o deviceKeyId da rota e o userId do JWT', async () => {
    const { controller: c, revoke } = controller();
    revoke.execute.mockResolvedValue(undefined);

    await c.revokeMachineDeviceKey('key-1', user);

    expect(revoke.execute).toHaveBeenCalledWith('key-1', 'user-1');
  });

  it('CASO DE FALHA: a chave de outra pessoa (404 do caso de uso) chega como 404, nunca como sucesso', async () => {
    const { controller: c, revoke } = controller();
    revoke.execute.mockRejectedValue(
      new NotFoundException('Chave de máquina não encontrada'),
    );

    await expect(
      c.revokeMachineDeviceKey('key-alheia', user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
