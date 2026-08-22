import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { PersonalAccessTokensController } from '../../../../src/interfaces/http/runner/personal-access-tokens.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import type { User } from '../../../../src/domain/iam/user.entity';

const user = { id: 'user-1' } as User;

function controller() {
  const issue = { execute: vi.fn() };
  const list = { execute: vi.fn() };
  const revoke = { execute: vi.fn() };
  return {
    controller: new PersonalAccessTokensController(
      issue as never,
      list as never,
      revoke as never,
    ),
    issue,
    list,
    revoke,
  };
}

describe('PersonalAccessTokensController', () => {
  it('as três rotas exigem developer — mesma régua de runner-ticket', () => {
    const reflector = new Reflector();
    for (const handler of [
      PersonalAccessTokensController.prototype.issuePat,
      PersonalAccessTokensController.prototype.listPats,
      PersonalAccessTokensController.prototype.revokePat,
    ]) {
      expect(reflector.get(REQUIRED_ROLE_KEY, handler)).toBe('developer');
    }
  });

  it('revokePat é 204', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        HTTP_CODE_METADATA,
        PersonalAccessTokensController.prototype.revokePat,
      ),
    ).toBe(204);
  });

  it('issuePat: delega ao use case com userId do CurrentUser, projectId da rota e o body', async () => {
    const { controller: c, issue } = controller();
    issue.execute.mockResolvedValue({ id: 'pat-1', token: 'brb_x' });

    await c.issuePat('proj-1', user, { name: 'laptop', expiresInDays: 7 });

    expect(issue.execute).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
      expiresInDays: 7,
    });
  });

  it('listPats: delega ao use case com userId e projectId', async () => {
    const { controller: c, list } = controller();
    list.execute.mockResolvedValue([]);

    await c.listPats('proj-1', user);

    expect(list.execute).toHaveBeenCalledWith('user-1', 'proj-1');
  });

  it('revokePat: delega ao use case com tokenId e userId — nunca com o projectId', async () => {
    const { controller: c, revoke } = controller();
    revoke.execute.mockResolvedValue(undefined);

    await c.revokePat('proj-1', 'pat-1', user);

    expect(revoke.execute).toHaveBeenCalledWith('pat-1', 'user-1');
  });
});
