import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RevokeRunnerDeviceKeyUseCase } from '../../../../src/application/use-cases/auth/revoke-runner-device-key.use-case';
import type { RunnerDeviceKeyRepository } from '../../../../src/application/ports/runner-device-key-repository.port';
import type {
  ApiToEngineClient,
  BalancoDeRevogacaoDeCredencial,
} from '../../../../src/application/ports/api-to-engine-client.port';
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

const BALANCO: BalancoDeRevogacaoDeCredencial = {
  derrubados: 1,
  legados: 0,
  intocados: 0,
  semResposta: 0,
  ticketsAnulados: 0,
};

function projeto(id: string): Project {
  return { id } as Project;
}

function montar(opts?: {
  revogar?: () => Promise<ChaveDeDispositivoResumo | null>;
  porChave?: () => Promise<BalancoDeRevogacaoDeCredencial>;
  peloPar?: () => Promise<'derrubado' | 'sem_runner' | 'de_outro_dono'>;
  projetosDoUsuario?: () => Promise<Project[]>;
}) {
  const revogar = vi.fn(opts?.revogar ?? (() => Promise.resolve(RESUMO)));
  const disconnectRunnerCredential = vi.fn(
    opts?.porChave ?? (() => Promise.resolve(BALANCO)),
  );
  const disconnectRunnerOfUser = vi.fn(
    opts?.peloPar ?? (() => Promise.resolve('derrubado' as const)),
  );
  const listRunnerModeReachableBy = vi.fn(
    opts?.projetosDoUsuario ?? (() => Promise.resolve([])),
  );
  const deviceKeys = { revogar } as unknown as RunnerDeviceKeyRepository;
  const engine = {
    disconnectRunnerCredential,
    disconnectRunnerOfUser,
  } as unknown as ApiToEngineClient;
  const projects = {
    listRunnerModeReachableBy,
  } as unknown as ProjectRepository;
  return {
    useCase: new RevokeRunnerDeviceKeyUseCase(deviceKeys, engine, projects),
    revogar,
    disconnectRunnerCredential,
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
    const { useCase, disconnectRunnerCredential, disconnectRunnerOfUser } =
      montar({ revogar: () => Promise.resolve(null) });

    await expect(
      useCase.execute('device-alheio', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Nada revogado, nada a derrubar — nunca derrubar o runner de ninguém por
    // causa de uma chave que não é do chamador.
    expect(disconnectRunnerCredential).not.toHaveBeenCalled();
    expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
  });

  describe('o alvo da queda é a CHAVE (ADR 0201, RN-685)', () => {
    it('pede ao engine que derrube as conexões DESTA chave, e só elas — nunca o par {projeto, usuário}', async () => {
      const { useCase, disconnectRunnerCredential, disconnectRunnerOfUser } =
        montar();

      await useCase.execute('device-1', 'user-1');

      expect(disconnectRunnerCredential).toHaveBeenCalledWith(
        { tipo: 'device_key', id: 'device-1' },
        // O alcance legado é o projeto da LINHA revogada — nunca o da URL.
        { userId: 'user-1', projectIds: ['proj-da-linha'] },
      );
      expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
    });

    it('revoga PRIMEIRO, derruba depois — o contrário deixaria janela para reconectar com a chave viva', async () => {
      const ordem: string[] = [];
      const revogar = vi.fn(() => {
        ordem.push('revogar');
        return Promise.resolve(RESUMO);
      });
      const disconnectRunnerCredential = vi.fn(() => {
        ordem.push('derrubar');
        return Promise.resolve(BALANCO);
      });
      const useCase = new RevokeRunnerDeviceKeyUseCase(
        { revogar } as unknown as RunnerDeviceKeyRepository,
        { disconnectRunnerCredential } as unknown as ApiToEngineClient,
        {
          listRunnerModeReachableBy: () => Promise.resolve([]),
        } as unknown as ProjectRepository,
      );

      await useCase.execute('device-1', 'user-1');

      expect(ordem).toEqual(['revogar', 'derrubar']);
    });

    it('nenhuma conexão derrubada é desfecho NORMAL — o caso de quem revoga uma chave órfã', async () => {
      const { useCase } = montar({
        porChave: () => Promise.resolve({ ...BALANCO, derrubados: 0 }),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(RESUMO);
    });

    it('chave de PROJETO nunca pergunta a lista de projetos — o alcance legado vem da linha', async () => {
      const { useCase, listRunnerModeReachableBy } = montar();

      await useCase.execute('device-1', 'user-1');

      expect(listRunnerModeReachableBy).not.toHaveBeenCalled();
    });
  });

  describe('CASO DE FALHA: o engine não atende o pedido por chave', () => {
    it('cai no alvo antigo, {projeto, usuário}, em vez de deixar a conexão de pé (RN-519)', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        porChave: () =>
          Promise.reject(new Error('Falha ...: 404 rota inexistente')),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(RESUMO);
      expect(disconnectRunnerOfUser).toHaveBeenCalledWith(
        'proj-da-linha',
        'user-1',
      );
    });

    it('engine fora do ar nas DUAS rotas não derruba a revogação nem vira exceção', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        porChave: () => Promise.reject(new Error('ECONNREFUSED')),
        peloPar: () => Promise.reject(new Error('ECONNREFUSED')),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(RESUMO);
      expect(disconnectRunnerOfUser).toHaveBeenCalledOnce();
    });
  });

  describe('chave de MÁQUINA (RN-543): UM pedido por chave, não o par aplicado N vezes', () => {
    it('um pedido só, com os projetos candidatos como alcance LEGADO', async () => {
      const {
        useCase,
        disconnectRunnerCredential,
        disconnectRunnerOfUser,
        listRunnerModeReachableBy,
      } = montar({
        revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
        projetosDoUsuario: () =>
          Promise.resolve([projeto('proj-a'), projeto('proj-b')]),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(
        RESUMO_DE_MAQUINA,
      );

      expect(listRunnerModeReachableBy).toHaveBeenCalledWith('user-1');
      expect(disconnectRunnerCredential).toHaveBeenCalledOnce();
      expect(disconnectRunnerCredential).toHaveBeenCalledWith(
        { tipo: 'device_key', id: 'device-1' },
        { userId: 'user-1', projectIds: ['proj-a', 'proj-b'] },
      );
      expect(disconnectRunnerOfUser).not.toHaveBeenCalled();
    });

    it('não conseguir LISTAR os projetos não impede a queda por chave — só o alcance legado fica vazio', async () => {
      const { useCase, disconnectRunnerCredential } = montar({
        revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
        projetosDoUsuario: () => Promise.reject(new Error('banco fora')),
      });

      await expect(useCase.execute('device-1', 'user-1')).resolves.toBe(
        RESUMO_DE_MAQUINA,
      );
      expect(disconnectRunnerCredential).toHaveBeenCalledWith(
        { tipo: 'device_key', id: 'device-1' },
        { userId: 'user-1', projectIds: [] },
      );
    });

    it('plano B da máquina: o par aplicado em CADA projeto candidato', async () => {
      const { useCase, disconnectRunnerOfUser } = montar({
        revogar: () => Promise.resolve(RESUMO_DE_MAQUINA),
        projetosDoUsuario: () =>
          Promise.resolve([projeto('proj-a'), projeto('proj-b')]),
        porChave: () => Promise.reject(new Error('404')),
      });

      await useCase.execute('device-1', 'user-1');

      expect(disconnectRunnerOfUser).toHaveBeenCalledTimes(2);
      expect(disconnectRunnerOfUser).toHaveBeenCalledWith('proj-a', 'user-1');
      expect(disconnectRunnerOfUser).toHaveBeenCalledWith('proj-b', 'user-1');
    });
  });
});
