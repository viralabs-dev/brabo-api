import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { AcessoRapidoUseCase } from '../../../../src/application/use-cases/acesso-rapido/acesso-rapido.use-case';
import type { UserRepository } from '../../../../src/application/ports/user-repository.port';
import type { WorkspaceRepository } from '../../../../src/application/ports/workspace-repository.port';
import type { EmitirSessaoUseCase } from '../../../../src/application/use-cases/auth/emitir-sessao.use-case';
import type { ProvisionarUsuarioUseCase } from '../../../../src/application/use-cases/auth/provisionar-usuario.use-case';

function harness(temUsuario = true) {
  const contas = new Map<string, string>();
  const workspaces: { id: string; slug: string; createdBy: string }[] = [];
  const membros = new Map<string, string>();

  const provisionar = {
    execute: vi.fn(({ email }: { email: string }) => {
      const criado = !contas.has(email);
      if (criado) contas.set(email, `id-${email}`);
      return Promise.resolve({
        user: { id: contas.get(email)! },
        criado,
      });
    }),
  };
  const ws = {
    listForUser: vi.fn((uid: string) =>
      Promise.resolve(
        workspaces
          .filter((w) => w.createdBy === uid)
          .map((w) => ({ workspace: w, role: 'owner' })),
      ),
    ),
    create: vi.fn((i: { slug: string; createdBy: string }) => {
      const w = { id: `ws-${workspaces.length + 1}`, ...i };
      workspaces.push(w);
      return Promise.resolve(w);
    }),
    findMemberRole: vi.fn((w: string, u: string) =>
      Promise.resolve(membros.get(`${w}|${u}`) ?? null),
    ),
    addMember: vi.fn((w: string, u: string, role: string) => {
      membros.set(`${w}|${u}`, role);
      return Promise.resolve({});
    }),
  };
  const emitir = {
    execute: vi.fn((e: { userId: string }) =>
      Promise.resolve({
        accessToken: `at:${e.userId}`,
        refreshToken: 'rt',
        expiresIn: 900,
        locale: 'pt-BR',
      }),
    ),
  };
  const registrar = vi.fn(() => Promise.resolve());
  const useCase = new AcessoRapidoUseCase(
    { runInTransaction: <T>(w: () => Promise<T>) => w() },
    {
      existeAlgumUsuario: () => Promise.resolve(temUsuario),
    } as unknown as UserRepository,
    provisionar as unknown as ProvisionarUsuarioUseCase,
    ws as unknown as WorkspaceRepository,
    emitir as unknown as EmitirSessaoUseCase,
    { registrar },
  );
  return { useCase, provisionar, ws, emitir, registrar, membros, workspaces };
}

describe('AcessoRapidoUseCase (AT-722)', () => {
  it('emite a sessão do papel pedido, audita dev_login e monta o workspace', async () => {
    const h = harness();
    const sessao = await h.useCase.execute('maintainer');

    expect(sessao.accessToken).toBe('at:id-maintainer@brabo.dev');
    expect(h.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'dev_login',
        metadata: { papel: 'maintainer' },
      }),
    );
    expect(h.workspaces).toHaveLength(1);
    expect(h.workspaces[0]).toMatchObject({
      slug: 'acesso-rapido-local',
      createdBy: 'id-owner@brabo.dev',
    });
    for (const papel of ['owner', 'maintainer', 'developer', 'viewer']) {
      expect(h.membros.get(`ws-1|id-${papel}@brabo.dev`)).toBe(papel);
    }
    // senha aleatória: nunca a mesma entre contas
    const senhas = h.provisionar.execute.mock.calls.map(
      (c) => (c[0] as unknown as { senha: string }).senha,
    );
    expect(new Set(senhas).size).toBe(4);
  });

  it('é idempotente: duas chamadas não duplicam workspace nem membros', async () => {
    const h = harness();
    await h.useCase.execute('viewer');
    const adds = h.ws.addMember.mock.calls.length;
    await h.useCase.execute('viewer');

    expect(h.workspaces).toHaveLength(1);
    expect(h.ws.create).toHaveBeenCalledTimes(1);
    expect(h.ws.addMember).toHaveBeenCalledTimes(adds);
    expect(h.membros.size).toBe(4);
  });

  it('instalação sem usuário: 409 e nada é criado', async () => {
    const h = harness(false);
    await expect(h.useCase.execute('owner')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(h.provisionar.execute).not.toHaveBeenCalled();
    expect(h.emitir.execute).not.toHaveBeenCalled();
  });
});
