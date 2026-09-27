import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  ContainerDoGoldenSetNaoSubiuError,
  IMAGEM_DO_GOLDEN_SET_QA,
  subirContainerDoCaso,
  type DependenciasDaSubida,
} from '../../scripts/golden-set-qa-container';
import { validarDecisaoDeImagem } from '../../src/domain/containers/project-container';
import type { ProposedAction } from '../../src/domain/actions/proposed-action.entity';

/**
 * AT-076: o golden-set do QA sobe o container de cada caso pelo caminho de
 * produção. O spec prova a SEQUÊNCIA (quem é chamado, com o quê) e que a
 * falha é NOMEADA — nunca um seed que termina "ok" sem container e deixa o QA
 * medir a recusa da RN-502 de novo.
 */

function acao(parcial: Partial<ProposedAction>): ProposedAction {
  return {
    id: 'acao-1',
    projectId: 'p1',
    sessionId: 's-infra',
    seq: 1,
    actionType: 'container_start',
    payload: {},
    status: 'pending',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'infra' },
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    executionResult: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...parcial,
  };
}

function dependencias(
  sobrescrever: Partial<Record<keyof DependenciasDaSubida, unknown>> = {},
) {
  const deps = {
    createSession: { execute: vi.fn().mockResolvedValue({ id: 's-infra' }) },
    transitionSession: { execute: vi.fn().mockResolvedValue({}) },
    createModuleMap: { execute: vi.fn().mockResolvedValue({}) },
    routeModulesToInfra: { execute: vi.fn().mockResolvedValue({}) },
    proposeAction: { execute: vi.fn().mockResolvedValue(acao({})) },
    approveAction: {
      execute: vi.fn().mockResolvedValue(
        acao({
          status: 'executed',
          executionResult: {
            motivo: null,
            imagem: IMAGEM_DO_GOLDEN_SET_QA,
            version: 1,
            network: 'none',
            resources: { cpus: 1, memoryMb: 1024, pidsLimit: 256 },
            containerId: 'c0ffee',
            jaEstavaDePe: false,
          },
        }),
      ),
    },
    obterCicloDeVida: {
      execute: vi.fn().mockResolvedValue({ status: 'running' }),
    },
    ...sobrescrever,
  };
  return deps as typeof deps & DependenciasDaSubida;
}

const entrada = { casoId: 'rf-covered', projectId: 'p1', userId: 'u1' };

describe('subirContainerDoCaso (AT-076)', () => {
  it('a imagem passa pelo MESMO validador do artefato, com digest', () => {
    expect(validarDecisaoDeImagem({
      image: IMAGEM_DO_GOLDEN_SET_QA,
      rationale: 'golden-set do QA',
    }).image).toBe(IMAGEM_DO_GOLDEN_SET_QA);
    expect(IMAGEM_DO_GOLDEN_SET_QA).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('caminho feliz: module_map → roteamento → proposta da Infra → aprovação do dono → running', async () => {
    const deps = dependencias();

    const resultado = await subirContainerDoCaso(deps, entrada);

    expect(resultado).toEqual({
      infraSessionId: 's-infra',
      actionId: 'acao-1',
      containerId: 'c0ffee',
    });
    expect(deps.createSession.execute).toHaveBeenCalledWith('p1', 'u1', {
      kind: 'consultiva',
      name: expect.stringContaining('rf-covered'),
    });
    const [, , roteamento] = vi.mocked(deps.routeModulesToInfra.execute).mock
      .calls[0];
    expect(roteamento.roteamento[0]).toMatchObject({
      modulo: 'app',
      imagemCandidata: IMAGEM_DO_GOLDEN_SET_QA,
    });
    // A imagem eleita é a candidata — é o que `ExecuteContainerStartUseCase`
    // confere antes de gravar a decisão.
    expect(deps.proposeAction.execute).toHaveBeenCalledWith('p1', 's-infra', {
      actionType: 'container_start',
      actor: { kind: 'agent', id: 'infra' },
      payload: expect.objectContaining({
        imagem: IMAGEM_DO_GOLDEN_SET_QA,
        network: 'none',
      }),
    });
    expect(deps.approveAction.execute).toHaveBeenCalledWith(
      'p1',
      's-infra',
      'acao-1',
      'u1',
    );
  });

  it('broker indisponível vira erro NOMEADO com o motivo do produto, não seed verde', async () => {
    const deps = dependencias({
      approveAction: {
        execute: vi.fn().mockResolvedValue(
          acao({
            status: 'failed',
            executionResult: {
              motivo:
                'o broker de container não respondeu em http://localhost:8090: fetch failed',
              imagem: '',
              version: 0,
              network: null,
              resources: null,
              containerId: null,
              jaEstavaDePe: false,
            },
          }),
        ),
      },
    });

    const falha = subirContainerDoCaso(deps, entrada);

    await expect(falha).rejects.toBeInstanceOf(ContainerDoGoldenSetNaoSubiuError);
    await expect(falha).rejects.toMatchObject({ etapa: 'aprovacao' });
    await expect(falha).rejects.toThrow(/não respondeu em http:\/\/localhost:8090/);
    await expect(falha).rejects.toThrow(/RN-502/);
    expect(deps.obterCicloDeVida.execute).not.toHaveBeenCalled();
  });

  it('instalação sem broker: a recusa 409 da proposta (RN-591) chega com o código', async () => {
    const deps = dependencias({
      proposeAction: {
        execute: vi.fn().mockRejectedValue(
          new ConflictException({
            code: 'sem_broker_na_instalacao',
            message: 'Esta instalação não tem broker de container (BROKER_URL vazia)',
          }),
        ),
      },
    });

    const falha = subirContainerDoCaso(deps, entrada);

    await expect(falha).rejects.toMatchObject({ etapa: 'proposta' });
    await expect(falha).rejects.toThrow(/sem_broker_na_instalacao: .*BROKER_URL vazia/);
    expect(deps.approveAction.execute).not.toHaveBeenCalled();
  });

  it('executada mas sem linha `running` registrada também recusa — é a pergunta do engine', async () => {
    const deps = dependencias({
      obterCicloDeVida: {
        execute: vi.fn().mockResolvedValue({ status: 'provisioning' }),
      },
    });

    await expect(subirContainerDoCaso(deps, entrada)).rejects.toMatchObject({
      etapa: 'ciclo_de_vida',
    });
  });
});
