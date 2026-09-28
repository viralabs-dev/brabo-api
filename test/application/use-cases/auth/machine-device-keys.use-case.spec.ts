import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ListMachineDeviceKeysUseCase } from '../../../../src/application/use-cases/auth/list-machine-device-keys.use-case';
import { RevokeMachineDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/revoke-machine-device-key.use-case';
import { RevokeRunnerDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/revoke-runner-device-key.use-case';
import type {
  ChaveDeDispositivoResumo,
  RunnerDeviceKeyRepository,
} from '../../../../src/application/ports/runner-device-key-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';

/**
 * As chaves de MÁQUINA por CONTA (RN-611, AT-118).
 *
 * A revogação aqui é a MESMA de `RevokeRunnerDeviceKeyUseCase` — por isso ela
 * entra de VERDADE, com repositório, engine e projetos de mentira: o que se
 * prova é o que a porta da Conta derruba DE FATO (um `disconnectRunnerOfUser`
 * por projeto em modo runner, alvo `{projeto, usuário}`), e um dublê do caso
 * de uso provaria só o dublê.
 */

const DE_MAQUINA: ChaveDeDispositivoResumo = {
  id: 'key-maquina',
  name: 'thinkpad',
  projectId: null,
  especie: 'maquina',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  revokedAt: null,
  lastUsedAt: null,
};

const REVOGADA: ChaveDeDispositivoResumo = {
  ...DE_MAQUINA,
  id: 'key-maquina-antiga',
  revokedAt: new Date('2026-09-21T10:00:00Z'),
  lastUsedAt: new Date('2026-09-20T12:00:00Z'),
};

function montar(opts: {
  minhas: ChaveDeDispositivoResumo[];
  projetos?: string[];
}) {
  const listarDeMaquinaDoUsuario = vi.fn(() => Promise.resolve(opts.minhas));
  const revogar = vi.fn((id: string) =>
    Promise.resolve(opts.minhas.find((chave) => chave.id === id) ?? null),
  );
  const deviceKeys = {
    listarDeMaquinaDoUsuario,
    revogar,
  } as unknown as RunnerDeviceKeyRepository;
  const disconnectRunnerOfUser = vi.fn(() =>
    Promise.resolve('derrubado' as const),
  );
  const engine = { disconnectRunnerOfUser } as unknown as ApiToEngineClient;
  const listRunnerModeReachableBy = vi.fn(() =>
    Promise.resolve((opts.projetos ?? []).map((id) => ({ id }) as Project)),
  );
  const projects = {
    listRunnerModeReachableBy,
  } as unknown as ProjectRepository;
  const revogacao = new RevokeRunnerDeviceKeyUseCase(
    deviceKeys,
    engine,
    projects,
  );
  return {
    listar: new ListMachineDeviceKeysUseCase(deviceKeys),
    revogarPelaConta: new RevokeMachineDeviceKeyUseCase(deviceKeys, revogacao),
    listarDeMaquinaDoUsuario,
    revogar,
    disconnectRunnerOfUser,
  };
}

describe('ListMachineDeviceKeysUseCase (RN-611)', () => {
  it('caminho feliz: pergunta ao repositório só pelo usuário — sem projeto nenhum', async () => {
    const { listar, listarDeMaquinaDoUsuario } = montar({
      minhas: [DE_MAQUINA],
    });

    await expect(listar.execute('user-1')).resolves.toEqual([DE_MAQUINA]);
    expect(listarDeMaquinaDoUsuario).toHaveBeenCalledWith('user-1');
  });

  it('a REVOGADA continua na lista — é por ela que se vê que registrar substituiu a anterior', async () => {
    const { listar } = montar({ minhas: [DE_MAQUINA, REVOGADA] });

    const lista = await listar.execute('user-1');

    expect(lista.map((c) => c.id)).toEqual([
      'key-maquina',
      'key-maquina-antiga',
    ]);
    expect(lista[1].revokedAt).not.toBeNull();
  });

  it('CASO DE FALHA: repositório que rejeita propaga — a lista não inventa vazio', async () => {
    const deviceKeys = {
      listarDeMaquinaDoUsuario: vi.fn(() =>
        Promise.reject(new Error('banco fora do ar')),
      ),
    } as unknown as RunnerDeviceKeyRepository;

    await expect(
      new ListMachineDeviceKeysUseCase(deviceKeys).execute('user-1'),
    ).rejects.toThrow('banco fora do ar');
  });
});

describe('RevokeMachineDeviceKeyUseCase (RN-611)', () => {
  it('caminho feliz: revoga e derruba o agente em CADA projeto em modo runner — alvo {projeto, usuário}', async () => {
    const { revogarPelaConta, revogar, disconnectRunnerOfUser } = montar({
      minhas: [DE_MAQUINA],
      projetos: ['proj-a', 'proj-b'],
    });

    await revogarPelaConta.execute('key-maquina', 'user-1');

    expect(revogar).toHaveBeenCalledWith(
      'key-maquina',
      'user-1',
      'user_requested',
    );
    // A assinatura do engine NÃO mudou: continua {projeto, usuário}, só que
    // chamada uma vez por projeto. Nenhuma chamada nomeia a chave.
    expect(disconnectRunnerOfUser.mock.calls).toEqual([
      ['proj-a', 'user-1'],
      ['proj-b', 'user-1'],
    ]);
  });

  it('instalação SEM projeto: grava a revogação e não tem conexão nenhuma a derrubar', async () => {
    const { revogarPelaConta, revogar, disconnectRunnerOfUser } = montar({
      minhas: [DE_MAQUINA],
      projetos: [],
    });

    await revogarPelaConta.execute('key-maquina', 'user-1');

    expect(revogar).toHaveBeenCalledTimes(1);
    expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
  });

  it('CASO DE FALHA: chave que não está entre as de máquina do chamador (de outro, ou de PROJETO) é 404 e nada é revogado', async () => {
    // O repositório de mentira só conhece as do chamador — é o WHERE por
    // `userId` que o de verdade faz. A chave de outra pessoa e a chave de
    // PROJETO do próprio usuário caem na MESMA resposta.
    const { revogarPelaConta, revogar, disconnectRunnerOfUser } = montar({
      minhas: [DE_MAQUINA],
      projetos: ['proj-a'],
    });

    await expect(
      revogarPelaConta.execute('key-de-outra-pessoa', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(revogar).not.toHaveBeenCalled();
    expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
  });

  it('idempotente: revogar a já revogada não é erro', async () => {
    const { revogarPelaConta } = montar({ minhas: [REVOGADA] });

    await expect(
      revogarPelaConta.execute('key-maquina-antiga', 'user-1'),
    ).resolves.toBe(REVOGADA);
  });
});
