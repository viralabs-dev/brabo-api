import { describe, it, expect, vi } from 'vitest';
import {
  ObterVisaoGeralDeContainersUseCase,
  TETO_DE_VERIFICACOES_POR_CARGA,
} from '../../../../src/application/use-cases/containers/obter-visao-geral-de-containers.use-case';
import { RECURSOS_PADRAO } from '../../../../src/domain/containers/project-container';
import type { ContainerOverviewRow } from '../../../../src/application/ports/containers-overview-repository.port';
import type { ContainerLifecycleStatus } from '../../../../src/domain/containers/container-lifecycle';
import type { EstadoObservado } from '../../../../src/application/use-cases/containers/obter-estado-observado-do-container.use-case';

function linha(
  projectId: string,
  status: ContainerLifecycleStatus,
): ContainerOverviewRow {
  return {
    projectId,
    projectName: projectId,
    projectSlug: projectId,
    lifecycle: {
      id: `lc-${projectId}`,
      projectId,
      status,
      imageVersion: 1,
      containerId: null,
      resources: RECURSOS_PADRAO,
      failureReason: null,
      createdAt: new Date(),
      statusChangedAt: new Date(),
    },
    imagem: 'node:22-bookworm-slim',
    acaoPendente: null,
  };
}

const OBSERVADO_OK: EstadoObservado = {
  observado: {
    containerId: 'c1',
    nome: 'brabo-x',
    estado: 'running',
    imagem: 'node:22-bookworm-slim',
    iniciadoEm: new Date().toISOString(),
  },
  naoObservado: null,
  detalhe: null,
};

function build(linhas: ContainerOverviewRow[], observar?: () => Promise<EstadoObservado>) {
  const chamadasAoBroker: string[] = [];
  const overview = { listForWorkspace: vi.fn(async () => linhas) };
  const obterEstadoObservado = {
    execute: vi.fn(async (projectId: string) => {
      chamadasAoBroker.push(projectId);
      return observar ? observar() : OBSERVADO_OK;
    }),
  };
  const useCase = new ObterVisaoGeralDeContainersUseCase(
    overview as never,
    obterEstadoObservado as never,
  );
  return { useCase, chamadasAoBroker, overview };
}

describe('ObterVisaoGeralDeContainersUseCase', () => {
  it('status "running"/"provisioning" são verificados no broker', async () => {
    const { useCase, chamadasAoBroker } = build([
      linha('p-running', 'running'),
      linha('p-provisioning', 'provisioning'),
    ]);

    const itens = await useCase.execute('ws-1');

    expect(chamadasAoBroker.sort()).toEqual(['p-provisioning', 'p-running']);
    for (const item of itens) {
      expect(item.naoVerificado).toBeNull();
      expect(item.observado).toEqual(OBSERVADO_OK.observado);
    }
  });

  it('status "stopped"/"failed"/"removed" NUNCA vão ao broker — fora do escopo da verificação', async () => {
    const { useCase, chamadasAoBroker } = build([
      linha('p-stopped', 'stopped'),
      linha('p-failed', 'failed'),
      linha('p-removed', 'removed'),
    ]);

    const itens = await useCase.execute('ws-1');

    expect(chamadasAoBroker).toEqual([]);
    for (const item of itens) {
      expect(item.naoVerificado).toBe('fora_do_escopo_da_verificacao');
      expect(item.observado).toBeNull();
      expect(item.naoObservado).toBeNull();
      expect(item.detalheDaObservacao).toBeNull();
    }
  });

  it('respeita o teto por carga — o que passa do teto vira teto_de_verificacoes_atingido, sem chamar o broker', async () => {
    const linhas = Array.from({ length: TETO_DE_VERIFICACOES_POR_CARGA + 5 }, (_, i) =>
      linha(`p-${i}`, 'running'),
    );
    const { useCase, chamadasAoBroker } = build(linhas);

    const itens = await useCase.execute('ws-1');

    expect(chamadasAoBroker).toHaveLength(TETO_DE_VERIFICACOES_POR_CARGA);
    const dentro = itens.filter((i) => i.naoVerificado === null);
    const fora = itens.filter(
      (i) => i.naoVerificado === 'teto_de_verificacoes_atingido',
    );
    expect(dentro).toHaveLength(TETO_DE_VERIFICACOES_POR_CARGA);
    expect(fora).toHaveLength(5);
    for (const item of fora) {
      expect(item.observado).toBeNull();
      expect(item.naoObservado).toBeNull();
    }
  });

  it('naoObservado do broker (recusou/sem-resposta/nao-configurado) nunca é confundido com naoVerificado', async () => {
    const { useCase } = build(
      [linha('p-1', 'running')],
      async () => ({
        observado: null,
        naoObservado: 'broker-sem-resposta',
        detalhe: 'timeout',
      }),
    );

    const [item] = await useCase.execute('ws-1');

    expect(item.naoVerificado).toBeNull();
    expect(item.observado).toBeNull();
    expect(item.naoObservado).toBe('broker-sem-resposta');
    expect(item.detalheDaObservacao).toBe('timeout');
  });

  it('propaga registrado, imagem e acaoPendente sem alteração', async () => {
    const comPendencia: ContainerOverviewRow = {
      ...linha('p-1', 'stopped'),
      acaoPendente: {
        id: 'pa-1',
        projectId: 'p-1',
        sessionId: 'sess-1',
        seq: 1,
        actionType: 'container_remove',
        payload: {},
        status: 'pending',
        resolvedPolicy: 'require_approval',
        actor: { kind: 'user', id: 'user-1' },
        decidedBy: null,
        decidedAt: null,
        rejectionReason: null,
        executionResult: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const { useCase } = build([comPendencia]);

    const [item] = await useCase.execute('ws-1');

    expect(item.registrado).toEqual(comPendencia.lifecycle);
    expect(item.imagem).toBe('node:22-bookworm-slim');
    expect(item.acaoPendente?.id).toBe('pa-1');
  });
});
