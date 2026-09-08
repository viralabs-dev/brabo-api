import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ContainersOverviewController } from '../../../../src/interfaces/http/containers/containers-overview.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { ContainerOverviewItem } from '../../../../src/application/use-cases/containers/obter-visao-geral-de-containers.use-case';

function makeItem(overrides: Partial<ContainerOverviewItem> = {}): ContainerOverviewItem {
  return {
    projectId: 'proj-1',
    projectName: 'core',
    projectSlug: 'core',
    executionMode: 'container',
    registrado: {
      id: 'lc-1',
      projectId: 'proj-1',
      status: 'running',
      imageVersion: 1,
      containerId: 'c1',
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: null,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      statusChangedAt: new Date('2026-08-01T10:05:00.000Z'),
    },
    imagem: 'node:22-bookworm-slim',
    temImagemDecidida: true,
    workspaceVerifiedAt: null,
    observado: null,
    naoObservado: null,
    detalheDaObservacao: null,
    naoVerificado: null,
    acaoPendente: null,
    ...overrides,
  };
}

/**
 * `GET /workspaces/:workspaceId/containers` (ADR 0136, RN-495/RN-521) — a
 * página global de containers, cross-projeto.
 */
describe('ContainersOverviewController', () => {
  it('exige viewer, mesma permissão da rota por projeto', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(REQUIRED_ROLE_KEY, ContainersOverviewController.prototype.list),
    ).toBe('viewer');
  });

  it('aninha o registrado num objeto próprio, datas em ISO', async () => {
    const obterVisaoGeral = { execute: vi.fn().mockResolvedValue([makeItem()]) };
    const controller = new ContainersOverviewController(obterVisaoGeral as never);

    const [linha] = await controller.list('ws-1');

    expect(obterVisaoGeral.execute).toHaveBeenCalledWith('ws-1');
    expect(linha).toEqual({
      projectId: 'proj-1',
      projectName: 'core',
      projectSlug: 'core',
      executionMode: 'container',
      registrado: {
        status: 'running',
        imageVersion: 1,
        imagem: 'node:22-bookworm-slim',
        resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
        failureReason: null,
        createdAt: '2026-08-01T10:00:00.000Z',
        statusChangedAt: '2026-08-01T10:05:00.000Z',
      },
      temImagemDecidida: true,
      workspaceVerifiedAt: null,
      observado: null,
      naoObservado: null,
      detalheDaObservacao: null,
      naoVerificado: null,
      acaoPendente: null,
    });
    // `id`/`containerId` internos não vazam na resposta.
    expect(linha.registrado).not.toHaveProperty('id');
    expect(linha.registrado).not.toHaveProperty('containerId');
  });

  /** RN-521: o terceiro estado sobrevive à conversão sem virar um `status`. */
  it('projeto que nunca provisionou vira registrado null, com motivo próprio em naoVerificado', async () => {
    const obterVisaoGeral = {
      execute: vi.fn().mockResolvedValue([
        makeItem({
          executionMode: 'runner',
          registrado: null,
          imagem: null,
          temImagemDecidida: true,
          workspaceVerifiedAt: new Date('2026-09-01T10:00:00.000Z'),
          naoVerificado: 'sem_container_registrado',
        }),
      ]),
    };
    const controller = new ContainersOverviewController(obterVisaoGeral as never);

    const [linha] = await controller.list('ws-1');

    expect(linha.registrado).toBeNull();
    expect(linha.naoVerificado).toBe('sem_container_registrado');
    expect(linha.naoObservado).toBeNull();
    expect(linha.executionMode).toBe('runner');
    expect(linha.temImagemDecidida).toBe(true);
    expect(linha.workspaceVerifiedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('naoVerificado sobrevive à conversão, distinto de naoObservado', async () => {
    const obterVisaoGeral = {
      execute: vi
        .fn()
        .mockResolvedValue([makeItem({ naoVerificado: 'teto_de_verificacoes_atingido' })]),
    };
    const controller = new ContainersOverviewController(obterVisaoGeral as never);

    const [linha] = await controller.list('ws-1');

    expect(linha.naoVerificado).toBe('teto_de_verificacoes_atingido');
    expect(linha.naoObservado).toBeNull();
  });

  it('acaoPendente converte as datas do ProposedAction para ISO, decidedAt null incluso', async () => {
    const obterVisaoGeral = {
      execute: vi.fn().mockResolvedValue([
        makeItem({
          acaoPendente: {
            id: 'pa-1',
            projectId: 'proj-1',
            sessionId: 'sess-1',
            seq: 1,
            actionType: 'container_stop',
            payload: {},
            status: 'pending',
            resolvedPolicy: 'require_approval',
            actor: { kind: 'user', id: 'user-1' },
            decidedBy: null,
            decidedAt: null,
            rejectionReason: null,
            executionResult: null,
            createdAt: new Date('2026-08-01T10:00:00.000Z'),
            updatedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        }),
      ]),
    };
    const controller = new ContainersOverviewController(obterVisaoGeral as never);

    const [linha] = await controller.list('ws-1');

    expect(linha.acaoPendente).toMatchObject({
      id: 'pa-1',
      actionType: 'container_stop',
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
      decidedAt: null,
    });
  });

  it('lista vazia quando o workspace não tem projeto nenhum', async () => {
    const obterVisaoGeral = { execute: vi.fn().mockResolvedValue([]) };
    const controller = new ContainersOverviewController(obterVisaoGeral as never);

    expect(await controller.list('ws-1')).toEqual([]);
  });
});
