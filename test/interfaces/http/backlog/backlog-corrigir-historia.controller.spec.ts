import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { BacklogController } from '../../../../src/interfaces/http/backlog/backlog.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../../src/domain/iam/role';

/* eslint-disable @typescript-eslint/unbound-method */

/**
 * RN-727: editar título e arquivar história pedem o MESMO papel das outras
 * escritas de backlog do usuário (promover/devolver, RN-048) — `developer`.
 */
describe('BacklogController — corrigir história (RN-727)', () => {
  const reflector = new Reflector();
  const papel = (m: (...a: never[]) => unknown) =>
    reflector.get<Role>(REQUIRED_ROLE_KEY, m);

  it('as duas rotas exigem o papel de promover/devolver', () => {
    const promover = papel(BacklogController.prototype.promote);
    expect(promover).toBe('developer');
    expect(papel(BacklogController.prototype.updateTitle)).toBe(promover);
    expect(papel(BacklogController.prototype.archive)).toBe(promover);
  });

  it.each<[Role, boolean]>([
    ['viewer', false],
    ['developer', true],
    ['maintainer', true],
  ])('%s alcança arquivar: %s', (p, alcanca) => {
    expect(roleAtLeast(p, papel(BacklogController.prototype.archive))).toBe(
      alcanca,
    );
  });
});
