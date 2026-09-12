import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokeRunnerDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/revoke-runner-device-key.use-case';
import type { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ChaveDeDispositivoResumo } from '../../../../src/application/ports/runner-device-key-repository.port';
import type { Project } from '../../../../src/domain/iam/project.entity';

const RESUMO: ChaveDeDispositivoResumo = {
  id: 'device-1',
  name: 'laptop',
  projectId: 'proj-da-linha',
  especie: 'projeto',
  createdAt: new Date(),
  revokedAt: new Date(),
  lastUsedAt: null,
};

/** A mesma chave, na espécie de MÁQUINA (RN-543): `projectId` nulo. */
const RESUMO_DE_MAQUINA: ChaveDeDispositivoResumo = {
  ...RESUMO,
  projectId: null,
  especie: 'maquina',
};

function projeto(id: string): Project {
  return { id } as Project;
}

function montar(opts?: {
  revogar?: () => Promise<ChaveDeDispositivoResumo | null>;
  disconnect?: () => Promise<'derrubado' | 'sem_runner' | 'de_outro_dono'>;
  projetosDoUsuario?: () => Promise<Project[]>;
}) {
  const revogar = vi.fn(opts?.revogar ?? (() => Promise.resolve(RESUMO)));
  const disconnectRunnerOfUser = vi.fn(
    opts?.disconnect ?? (() => Promise.resolve('derrubado' as const)),
  );
  const listRunnerModeReachableBy = vi.fn(
    opts?.projetosDoUsuario ?? (() => Promise.resolve([])),
  );
  const deviceKeys = { revogar } as unknown as RunnerDeviceKeyRepository;
  const engine = { disconnectRunnerOfUser } as unknown as ApiToEngineClient;
  const projects = {
    listRunnerModeReachableBy,
  } as unknown as ProjectRepository;
  return {
    useCase: new RevokeRunnerDeviceKeyUseCase(deviceKeys, engine, projects),
    revogar,
    disconnectRunnerOfUser,
    listRunnerModeReachableBy,
  };
}

describe('RevokeRunnerDeviceKeyUseCase', () => {
  it('caminho feliz: revoga e devolve o resumo', async () => {
    const { useCase, revogar } = montar();

    const resultado = await useCase.execute('device-1', 'user-1');

    expect(resultado).toBe(RESUMO);
    expect(revogar).toHaveBeenCalledWith(
      'device-1',
      'user-1',
      'user_requested',
    );
  });

  it('repositório devolve null (não existe ou não é do usuário): 404', async () => {
    const { useCase, disconnectRunnerOfUser } = montar({
      revogar: () => Promise.resolve(null),
    });

    await expect(
      useCase.execute('device-alheio', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Nada revogado, nada a derrubar — nunca derrubar o runner de um projeto
    // por causa de uma chave que não é do chamador.
    expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
  });

  describe('a revogação alcança a conexão viva (RN-520)', () => {
    it('pede ao engine que derrube o runner, com o projeto da LINHA revogada — nunca o da URL', async () => {
      const { useCase, disconnectRunnerOfUser } = montar();

      await useCase.execute('device-1', 'user-1');

      expect(disconnectRunnerOfUser).toHaveBeenCalledWith(
        'proj-da-linha',
        'user-1',
      );
    });

    it('revoga PRIMEIRO, derruba depois — o contrário deixaria janela para reconectar com a chave viva', async () => {
      const ordem: string[] = [];
      const revogar = vi.fn(() => {
        ordem.push('revogar');
        return Promise.resolve(RESUMO);
      });
      const disconnectRunnerOfUser = vi.fn(() => {
        ordem.push('derrubar');
        return Promise.resolve('derrubado' as const);
      });
      const useCase = new RevokeRunnerDeviceKeyUseCase(
        { revogar } as unknown as RunnerDeviceKeyRepository,
        { disconnectRunnerOfUser } as unknown as ApiToEngineClient,
        {
          listRunnerModeReachableBy: () => Promise.resolve([]),
        } as unknown as ProjectRepository,
      );

      await useCase.execute('device-1', 'user-1');

      expect(ordem).toEqual(['revogar', 'derrubar']);
    });

    it('CASO DE FALHA: engine fora do ar não derruba a revogação nem vira exceção', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        disconnect: () => Promise.reject(new Error('ECONNREFUSED')),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(RESUMO);
      expect(disconnectRunnerOfUser).toHaveBeenCalledOnce();
    });

    it('nenhum runner conectado é desfecho NORMAL — o caso de quem revoga uma chave órfã', async () => {
      const { useCase } = montar({
        disconnect: () => Promise.resolve('sem_runner' as const),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(RESUMO);
    });

    it('chave de PROJETO nunca pergunta a lista de projetos — o alvo vem da linha', async () => {
      const { useCase, listRunnerModeReachableBy } = montar();

      await useCase.execute('device-1', 'user-1');

      expect(listRunnerModeReachableBy).not.toHaveBeenCalled();
    });
  });

  describe('chave de MÁQUINA: o alvo da desconexão vira PLURAL (RN-543)', () => {
    it('derruba o runner em CADA projeto em modo runner que o dono alcança', async () => {
      const { useCase, disconnectRunnerOfUser, listRunnerModeReachableBy } =
        montar({
          revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
          projetosDoUsuario: () =>
            Promise.resolve([projeto('proj-a'), projeto('proj-b')]),
        });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(
        RESUMO_DE_MAQUINA,
      );

      expect(listRunnerModeReachableBy).toHaveBeenCalledWith('user-1');
      expect(disconnectRunnerOfUser).toHaveBeenCalledTimes(2);
      expect(disconnectRunnerOfUser).toHaveBeenCalledWith('proj-a', 'user-1');
      expect(disconnectRunnerOfUser).toHaveBeenCalledWith('proj-b', 'user-1');
    });

    it('CASO DE FALHA: não conseguir LISTAR os projetos não derruba a revogação', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
        projetosDoUsuario: () => Promise.reject(new Error('banco fora')),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(
        RESUMO_DE_MAQUINA,
      );
      expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
    });

    it('nenhum projeto em modo runner: revoga e não pede desconexão nenhuma', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(
        RESUMO_DE_MAQUINA,
      );
      expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
    });
  });
});
