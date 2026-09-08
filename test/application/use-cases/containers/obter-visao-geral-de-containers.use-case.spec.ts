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
    executionMode: 'container',
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
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    acaoPendente: null,
  };
}

/** Projeto que NUNCA provisionou container — o terceiro estado da RN-521. */
function linhaSemContainer(
  projectId: string,
  overrides: Partial<ContainerOverviewRow> = {},
): ContainerOverviewRow {
  return {
    projectId,
    projectName: projectId,
    projectSlug: projectId,
    executionMode: 'runner',
    lifecycle: null,
    imagem: null,
    temImagemDecidida: false,
    workspaceVerifiedAt: null,
    acaoPendente: null,
    ...overrides,
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

  // --- RN-521: o TERCEIRO estado, e o orçamento que ele não gasta ---

  it('projeto sem project_containers entra na lista com registrado null e motivo PRÓPRIO', async () => {
    const { useCase, chamadasAoBroker } = build([linhaSemContainer('p-novo')]);

    const [item] = await useCase.execute('ws-1');

    expect(item.registrado).toBeNull();
    expect(item.naoVerificado).toBe('sem_container_registrado');
    // Não é `stopped` (não há status nenhum) e não é "não observado" (o broker
    // nem foi perguntado) — os três motivos são distintos.
    expect(item.naoObservado).toBeNull();
    expect(item.observado).toBeNull();
    expect(chamadasAoBroker).toEqual([]);
  });

  it('projeto sem container NUNCA consome o orçamento do broker — quem tem container real continua verificado', async () => {
    // 25 projetos sem container ANTES dos 20 com container: se os vazios
    // ocupassem vaga, nenhum dos reais seria verificado.
    const vazios = Array.from({ length: 25 }, (_, i) =>
      linhaSemContainer(`vazio-${i}`),
    );
    const reais = Array.from({ length: TETO_DE_VERIFICACOES_POR_CARGA }, (_, i) =>
      linha(`real-${i}`, 'running'),
    );
    const { useCase, chamadasAoBroker } = build([...vazios, ...reais]);

    const itens = await useCase.execute('ws-1');

    expect(chamadasAoBroker.sort()).toEqual(reais.map((r) => r.projectId).sort());
    expect(
      itens.filter((i) => i.naoVerificado === 'teto_de_verificacoes_atingido'),
    ).toHaveLength(0);
    expect(
      itens.filter((i) => i.naoVerificado === 'sem_container_registrado'),
    ).toHaveLength(25);
  });

  it('propaga executionMode, temImagemDecidida e workspaceVerifiedAt — o que a tela usa para decidir a ação', async () => {
    const confirmadoEm = new Date('2026-09-01T10:00:00.000Z');
    const { useCase } = build([
      linhaSemContainer('p-runner', {
        executionMode: 'runner',
        temImagemDecidida: true,
        workspaceVerifiedAt: confirmadoEm,
      }),
    ]);

    const [item] = await useCase.execute('ws-1');

    expect(item.executionMode).toBe('runner');
    expect(item.temImagemDecidida).toBe(true);
    expect(item.workspaceVerifiedAt).toEqual(confirmadoEm);
  });
});
