import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ContainersController } from '../../../../src/interfaces/http/containers/containers.controller';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import type { ProjectContainerLifecycle } from '../../../../src/domain/containers/container-lifecycle';

/**
 * O duplo do estado OBSERVADO (ADR 0130). O default é "não observado por falta
 * de broker", que é o estado NORMAL de quem não subiu o profile
 * `container-broker` — e é justamente o caso em que a resposta não pode herdar
 * o estado registrado.
 */
function naoObservado(observado: unknown = null) {
  return {
    execute: vi.fn().mockResolvedValue(
      observado === null
        ? {
            observado: null,
            naoObservado: 'broker-nao-configurado',
            detalhe: null,
          }
        : { observado, naoObservado: null, detalhe: null },
    ),
  };
}

/**
 * `GET /projects/:projectId/container/lifecycle` — RN-267.
 *
 * A primeira exposição HTTP de `ObterCicloDeVidaDoContainerUseCase` (ADR
 * 0081/0083): o consumidor real que o ADR 0081 disse faltar para justificar
 * a rota é a aba Terminal (RN-268), que precisa mostrar o estado registrado
 * do container em vez de fingir um terminal que não existe.
 */
describe('ContainersController — ciclo de vida do container (RN-267)', () => {
  it('exige viewer, a mesma permissão da rota de decisão de imagem', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(
        REQUIRED_ROLE_KEY,
        ContainersController.prototype.cicloDeVida,
      ),
    ).toBe('viewer');
  });

  it('projeto nunca provisionado devolve null — nunca um erro nem um estado inventado', async () => {
    const obter = { execute: vi.fn().mockResolvedValue(null) };
    const obterCicloDeVida = { execute: vi.fn().mockResolvedValue(null) };
    const controller = new ContainersController(
      obter as never,
      obterCicloDeVida as never,
      naoObservado() as never,
    );

    const resultado = await controller.cicloDeVida('projeto-1');

    expect(resultado).toBeNull();
    expect(obterCicloDeVida.execute).toHaveBeenCalledWith('projeto-1');
  });

  it('projeto provisionado devolve o estado registrado, com datas em ISO', async () => {
    const linha: ProjectContainerLifecycle = {
      id: 'linha-1',
      projectId: 'projeto-1',
      status: 'running',
      imageVersion: 2,
      containerId: null,
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: null,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      statusChangedAt: new Date('2026-08-01T10:05:00.000Z'),
    };
    const obter = { execute: vi.fn() };
    const obterCicloDeVida = { execute: vi.fn().mockResolvedValue(linha) };
    const controller = new ContainersController(
      obter as never,
      obterCicloDeVida as never,
      naoObservado() as never,
    );

    const resultado = await controller.cicloDeVida('projeto-1');

    expect(resultado).toEqual({
      status: 'running',
      imageVersion: 2,
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: null,
      createdAt: '2026-08-01T10:00:00.000Z',
      statusChangedAt: '2026-08-01T10:05:00.000Z',
      // O par registrado/observado nunca se funde (RN-486, ADR 0130). Sem
      // broker configurado, o observado é `null` COM motivo — nunca herda o
      // `running` registrado acima.
      observado: null,
      naoObservado: 'broker-nao-configurado',
      detalheDaObservacao: null,
    });
    // `containerId`/`id`/`projectId` não vazam na resposta — a linha interna
    // não é o mesmo contrato que a rota expõe.
    expect(resultado).not.toHaveProperty('containerId');
    expect(resultado).not.toHaveProperty('id');
  });

  it('registrado `running` e observado `exited` convivem, sem se fundir', async () => {
    // Container morto por fora: antes do broker a tabela não tinha como
    // mentir (`container_id` era sempre NULL); agora tem, e a leitura diz.
    const linha: ProjectContainerLifecycle = {
      id: 'linha-3',
      projectId: 'projeto-3',
      status: 'running',
      imageVersion: 2,
      containerId: 'c0ffee',
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: null,
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      statusChangedAt: new Date('2026-08-01T10:05:00.000Z'),
    };
    const controller = new ContainersController(
      { execute: vi.fn() } as never,
      { execute: vi.fn().mockResolvedValue(linha) } as never,
      naoObservado({
        containerId: 'c0ffee',
        nome: 'brabo-projeto-3',
        estado: 'exited',
        imagem: 'node:22-bookworm-slim',
        iniciadoEm: '2026-08-01T10:05:00.000Z',
      }) as never,
    );

    const resultado = await controller.cicloDeVida('projeto-3');

    expect(resultado).toMatchObject({
      status: 'running',
      observado: { estado: 'exited' },
      naoObservado: null,
    });
  });

  it('estado `failed` inclui o motivo — o único caso em que a coluna é populada', async () => {
    const linha: ProjectContainerLifecycle = {
      id: 'linha-2',
      projectId: 'projeto-2',
      status: 'failed',
      imageVersion: 1,
      containerId: null,
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      failureReason: 'orquestrador inexistente — transição forçada em teste',
      createdAt: new Date('2026-08-01T10:00:00.000Z'),
      statusChangedAt: new Date('2026-08-01T10:10:00.000Z'),
    };
    const obter = { execute: vi.fn() };
    const obterCicloDeVida = { execute: vi.fn().mockResolvedValue(linha) };
    const controller = new ContainersController(
      obter as never,
      obterCicloDeVida as never,
      naoObservado() as never,
    );

    const resultado = await controller.cicloDeVida('projeto-2');

    expect(resultado).toMatchObject({
      status: 'failed',
      failureReason: 'orquestrador inexistente — transição forçada em teste',
    });
  });
});
