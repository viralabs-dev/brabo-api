import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { ForbiddenException } from '@nestjs/common';
import { WorkspacesController } from '../../../../src/interfaces/http/iam/workspaces.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { User } from '../../../../src/domain/iam/user.entity';
import { MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE } from '../../../../src/domain/iam/tetos-de-rebaixamento';

/*
 * `Controller.prototype.<método>` entra aqui como CHAVE de metadata: o
 * `Reflector` só lê o que os decorators penduraram no método, nunca o invoca
 * (a mesma supressão de `workspaces-project-folders.controller.spec.ts`).
 */
/* eslint-disable @typescript-eslint/unbound-method */

/**
 * `DELETE /workspaces/:workspaceId/members/:userId` — ADR 0173, RN-615.
 *
 * O `owner` da rota é METADE da prova de que o último dono não sai: a outra
 * metade é a cláusula do caso de uso (ninguém remove a si mesmo). Se o mínimo
 * desta rota cair, a demonstração do ADR cai junto — por isso ele é asserido
 * aqui, ao lado do upsert, que tem o mesmo mínimo pela mesma razão.
 */
const user = { id: 'dono-1' } as User;

function novoController() {
  const inerte = { execute: vi.fn() } as never;
  const remover = { execute: vi.fn() };
  const controller = new WorkspacesController(
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    inerte,
    remover as never,
  );
  return { controller, remover };
}

describe('WorkspacesController — remoção de membro', () => {
  it('exige owner, o MESMO mínimo do upsert de membro', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        WorkspacesController.prototype.removeMember,
      ),
    ).toBe('owner');
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        WorkspacesController.prototype.addMember,
      ),
    ).toBe('owner');
  });

  it('responde 204, sem corpo', () => {
    expect(
      new Reflector().get(
        HTTP_CODE_METADATA,
        WorkspacesController.prototype.removeMember,
      ),
    ).toBe(204);
  });

  it('delega com o ATOR do CurrentUser e o alvo da rota, nessa ordem', async () => {
    const { controller, remover } = novoController();
    remover.execute.mockResolvedValue(undefined);

    await controller.removeMember('ws-1', user, 'alvo-1');

    expect(remover.execute).toHaveBeenCalledWith('ws-1', 'dono-1', 'alvo-1');
  });

  it('propaga o 403 do teto sem traduzir', async () => {
    const { controller, remover } = novoController();
    remover.execute.mockRejectedValue(
      new ForbiddenException(MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE),
    );

    await expect(
      controller.removeMember('ws-1', user, 'dono-1'),
    ).rejects.toThrow(MENSAGEM_TETO_AUTO_REMOCAO_DO_WORKSPACE);
  });
});
