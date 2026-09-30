import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { SessionsController } from '../../../../src/interfaces/http/sessions/sessions.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../../src/domain/iam/role';

/*
 * `Controller.prototype.<método>` entra aqui como CHAVE de metadata (mesma
 * supressão de `projects-execution-mode.controller.spec.ts`).
 */
/* eslint-disable @typescript-eslint/unbound-method */

/**
 * `POST /projects/:projectId/sessions/:sessionId/reopen` — ADR 0183/0184,
 * RN-650.
 *
 * `developer`, o MESMO papel da transição genérica: decisão do dono (ADR 0184,
 * AT-337) sobre o padrão provisório `maintainer` do ADR 0183.
 */
describe('SessionsController — reabrir sessão (RN-650)', () => {
  it('exige developer, o mesmo papel da transição genérica', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(REQUIRED_ROLE_KEY, SessionsController.prototype.reopen),
    ).toBe('developer');
    expect(
      reflector.get(REQUIRED_ROLE_KEY, SessionsController.prototype.transition),
    ).toBe('developer');
  });

  /*
   * A régua que o `RolesGuard` aplica ao papel da rota (`roleAtLeast`, a
   * mesma função): developer, maintainer e owner passam; viewer é 403.
   */
  it.each<[Role, boolean]>([
    ['viewer', false],
    ['developer', true],
    ['maintainer', true],
    ['owner', true],
  ])('%s alcança o papel da rota: %s', (papel, alcanca) => {
    const exigido = new Reflector().get<Role>(
      REQUIRED_ROLE_KEY,
      SessionsController.prototype.reopen,
    );
    expect(roleAtLeast(papel, exigido)).toBe(alcanca);
  });

  it('responde 200, não o 201 padrão de @Post', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        SessionsController.prototype.reopen,
      ),
    ).toBe(200);
  });

  it('repassa projeto, sessão e o usuário autenticado ao caso de uso', async () => {
    const reopen = {
      execute: vi.fn().mockResolvedValue({ id: 's1', status: 'active' }),
    };
    const nada = { execute: vi.fn() } as never;
    const controller = new SessionsController(
      nada,
      nada,
      nada,
      nada,
      nada,
      reopen as never,
      nada,
      nada,
      nada,
      nada,
    );

    const resultado = await controller.reopen('p1', 's1', {
      id: 'u1',
    } as never);

    expect(reopen.execute).toHaveBeenCalledWith('p1', 's1', 'u1');
    expect(resultado).toEqual({ id: 's1', status: 'active' });
  });
});
