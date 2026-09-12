import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { RegistrarChaveDeMaquinaUseCase } from '../../../../src/application/use-cases/auth/registrar-chave-de-maquina.use-case';
import type { AuthEventRecorder } from '../../../../src/application/ports/auth-event-recorder.port';
import type { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { UserRepository } from '../../../../src/application/ports/user-repository.port';

const JWK_PUBLICA = JSON.stringify({
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'ZGVhZGJlZWY',
});

function buildHarness(opts: { dono?: unknown; substituidas?: string[] } = {}) {
  const runInTransaction = vi.fn(<T>(work: () => Promise<T>) => work());
  const unitOfWork = { runInTransaction } as unknown as UnitOfWork;

  const usuarioUnicoDaInstalacao = vi.fn(() =>
    Promise.resolve(opts.dono === undefined ? { id: 'user-1' } : opts.dono),
  );
  const usuarios = {
    usuarioUnicoDaInstalacao,
  } as unknown as UserRepository;

  const revogarChavesDeMaquina = vi.fn(() =>
    Promise.resolve(opts.substituidas ?? []),
  );
  const registrar = vi.fn((nova: { name: string; projectId: unknown }) =>
    Promise.resolve({
      id: 'device-1',
      name: nova.name,
      projectId: nova.projectId,
      especie: 'maquina',
      createdAt: new Date('2026-09-12T12:00:00.000Z'),
      revokedAt: null,
      lastUsedAt: null,
    }),
  );
  const deviceKeys = {
    registrar,
    revogarChavesDeMaquina,
  } as unknown as RunnerDeviceKeyRepository;

  const registrarEvento = vi.fn(() => Promise.resolve());
  const eventos = {
    registrar: registrarEvento,
  } as unknown as AuthEventRecorder;

  return {
    useCase: new RegistrarChaveDeMaquinaUseCase(
      unitOfWork,
      usuarios,
      deviceKeys,
      eventos,
    ),
    usuarioUnicoDaInstalacao,
    revogarChavesDeMaquina,
    registrar,
    registrarEvento,
  };
}

describe('RegistrarChaveDeMaquinaUseCase (RN-552, ADR 0155 ponto 4)', () => {
  it('caminho feliz: grava com `projectId` NULO, para o usuário que a api resolveu, e devolve o id do `kid`', async () => {
    const h = buildHarness();

    const registrada = await h.useCase.execute({
      name: 'servidor-de-casa',
      publicKeyJwk: JWK_PUBLICA,
    });

    expect(registrada).toEqual({
      id: 'device-1',
      userId: 'user-1',
      name: 'servidor-de-casa',
      createdAt: new Date('2026-09-12T12:00:00.000Z'),
      substituidas: [],
    });
    // `projectId: null` é o que FAZ dela uma chave de máquina (RN-543), e o
    // dono NUNCA veio do chamador.
    expect(h.registrar).toHaveBeenCalledWith({
      userId: 'user-1',
      projectId: null,
      name: 'servidor-de-casa',
      publicKeyJwk: JWK_PUBLICA,
    });
  });

  it('instalação com MAIS DE UM usuário: 409, e nada é escrito', async () => {
    const h = buildHarness({ dono: null });

    await expect(
      h.useCase.execute({ name: 'servidor', publicKeyJwk: JWK_PUBLICA }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(h.registrar).not.toHaveBeenCalled();
    expect(h.revogarChavesDeMaquina).not.toHaveBeenCalled();
    expect(h.registrarEvento).not.toHaveBeenCalled();
  });

  it('registrar SUBSTITUI: revoga as de máquina ativas ANTES de gravar, e DIZ quais caíram', async () => {
    const h = buildHarness({ substituidas: ['device-velha'] });

    const registrada = await h.useCase.execute({
      name: 'servidor-de-casa',
      publicKeyJwk: JWK_PUBLICA,
    });

    expect(registrada.substituidas).toEqual(['device-velha']);
    expect(h.revogarChavesDeMaquina).toHaveBeenCalledWith(
      'user-1',
      expect.stringContaining('instalador'),
    );
    // A ordem é o mecanismo: revogar DEPOIS deixaria uma janela com as duas
    // vivas.
    expect(h.revogarChavesDeMaquina.mock.invocationCallOrder[0]).toBeLessThan(
      h.registrar.mock.invocationCallOrder[0],
    );
  });

  it('chave PRIVADA mandada por engano: 400 antes de abrir transação — nunca gravada', async () => {
    const h = buildHarness();

    await expect(
      h.useCase.execute({
        name: 'servidor',
        publicKeyJwk: JSON.stringify({
          kty: 'OKP',
          crv: 'Ed25519',
          x: 'ZGVhZGJlZWY',
          d: 'ZGVhZGJlZWY',
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.usuarioUnicoDaInstalacao).not.toHaveBeenCalled();
    expect(h.registrar).not.toHaveBeenCalled();
  });

  it('a trilha de auth registra QUEM e o que caiu junto — nunca a JWK', async () => {
    const h = buildHarness({ substituidas: ['device-velha'] });

    await h.useCase.execute({
      name: 'servidor',
      publicKeyJwk: JWK_PUBLICA,
    });

    expect(h.registrarEvento).toHaveBeenCalledWith({
      kind: 'machine_device_key_registered',
      subjectKey: 'user:user-1',
      userId: 'user-1',
      metadata: { deviceKeyId: 'device-1', substituidas: ['device-velha'] },
    });
    const gravado = JSON.stringify(h.registrarEvento.mock.calls[0]);
    expect(gravado).not.toContain('ZGVhZGJlZWY');
  });
});
