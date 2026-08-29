import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegisterRunnerDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/register-runner-device-key.use-case';
import type { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';

const JWK_VALIDA = JSON.stringify({
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'ZGVhZGJlZWY',
});

function buildHarness(opts: { project?: unknown } = {}) {
  const project = opts.project === undefined ? { id: 'proj-1' } : opts.project;
  const projects = {
    findById: vi.fn(() => Promise.resolve(project)),
  } as unknown as ProjectRepository;
  const registrar = vi.fn((nova: unknown) =>
    Promise.resolve({
      id: 'device-1',
      name: (nova as { name: string }).name,
      projectId: (nova as { projectId: string }).projectId,
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
    }),
  );
  const deviceKeys = { registrar } as unknown as RunnerDeviceKeyRepository;

  return {
    useCase: new RegisterRunnerDeviceKeyUseCase(deviceKeys, projects),
    registrar,
  };
}

describe('RegisterRunnerDeviceKeyUseCase', () => {
  it('caminho feliz: registra a JWK pública tal como recebida, sem segredo nenhum', async () => {
    const { useCase, registrar } = buildHarness();

    const registrada = await useCase.execute({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
      publicKeyJwk: JWK_VALIDA,
    });

    expect(registrada.id).toBe('device-1');
    expect(registrar).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: 'proj-1',
      name: 'laptop',
      publicKeyJwk: JWK_VALIDA,
    });
  });

  it('JWK malformada (JSON inválido): rejeita antes de persistir', async () => {
    const { useCase, registrar } = buildHarness();

    await expect(
      useCase.execute({
        userId: 'user-1',
        projectId: 'proj-1',
        name: 'laptop',
        publicKeyJwk: '{ isto não é json',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('JWK com kty/crv errados (ex.: RSA): rejeita antes de persistir', async () => {
    const { useCase, registrar } = buildHarness();

    await expect(
      useCase.execute({
        userId: 'user-1',
        projectId: 'proj-1',
        name: 'laptop',
        publicKeyJwk: JSON.stringify({ kty: 'RSA', n: 'x', e: 'AQAB' }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('JWK Ed25519 sem "x": rejeita antes de persistir', async () => {
    const { useCase, registrar } = buildHarness();

    await expect(
      useCase.execute({
        userId: 'user-1',
        projectId: 'proj-1',
        name: 'laptop',
        publicKeyJwk: JSON.stringify({ kty: 'OKP', crv: 'Ed25519' }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(registrar).not.toHaveBeenCalled();
  });

  it('projeto inexistente: 404, nunca chega a registrar', async () => {
    const { useCase, registrar } = buildHarness({ project: null });

    await expect(
      useCase.execute({
        userId: 'user-1',
        projectId: 'proj-sumiu',
        name: 'laptop',
        publicKeyJwk: JWK_VALIDA,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(registrar).not.toHaveBeenCalled();
  });
});
