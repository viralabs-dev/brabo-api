import { describe, it, expect } from 'vitest';
import { AcceptParallelizationUseCase } from '../../../../src/application/use-cases/execution/accept-parallelization.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { AgentAutonomyRepository } from '../../../../src/application/ports/agent-autonomy-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { UpsertAgentInstructionUseCase } from '../../../../src/application/use-cases/agents/upsert-agent-instruction.use-case';
import type { RecordDelegationUseCase } from '../../../../src/application/use-cases/execution/record-delegation.use-case';

interface BuildOptions {
  moduleFound?: boolean;
  moduleMapEventIds?: string[] | null;
  recordDelegationFails?: boolean;
}

function build(engineFails: boolean, opts: BuildOptions = {}) {
  const {
    moduleFound = true,
    moduleMapEventIds = ['event-module-map-1'],
    recordDelegationFails = false,
  } = opts;

  const ordem: string[] = [];
  const autonomias: { agentId: string; type: string; mode: string }[] = [];
  const instrucoes: { agentId: string; content: string }[] = [];
  const delegacoes: Record<string, unknown>[] = [];

  const engineClient = {
    acceptParallelization: () => {
      ordem.push('engine');
      return engineFails
        ? Promise.reject(new Error('Falha no comando ao engine: 409'))
        : Promise.resolve();
    },
  } as unknown as ApiToEngineClient;

  const moduleMaps = {
    findCurrent: () =>
      Promise.resolve(
        moduleFound
          ? {
              modules: [
                {
                  name: 'api',
                  stack: 'NestJS',
                  responsibility: 'regras de negócio',
                  dependsOn: [],
                },
              ],
            }
          : { modules: [] },
      ),
  } as unknown as ModuleMapRepository;

  const agentAutonomy = {
    upsert: (_p: string, agentId: string, type: string, mode: string) => {
      ordem.push('autonomia');
      autonomias.push({ agentId, type, mode });
      return Promise.resolve();
    },
  } as unknown as AgentAutonomyRepository;

  const upsertInstruction = {
    execute: (_p: string, agentId: string, content: string) => {
      ordem.push('instrucao');
      instrucoes.push({ agentId, content });
      return Promise.resolve({});
    },
  } as unknown as UpsertAgentInstructionUseCase;

  const appendEvent = {
    execute: () => {
      ordem.push('evento');
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  const sessionEvents = {
    listByTypeForProject: (_projectId: string, type: string) => {
      ordem.push('busca-module-map');
      expect(type).toBe('artifact.module_map');
      return Promise.resolve(
        (moduleMapEventIds ?? []).map((id) => ({ id })),
      );
    },
  } as unknown as SessionEventRepository;

  const recordDelegation = {
    execute: (_p: string, _s: string, input: Record<string, unknown>) => {
      ordem.push('delegacao');
      if (recordDelegationFails) {
        return Promise.reject(new Error('delegações fora do ar'));
      }
      delegacoes.push(input);
      return Promise.resolve({ id: 'delegation-1', ...input });
    },
  } as unknown as RecordDelegationUseCase;

  return {
    useCase: new AcceptParallelizationUseCase(
      engineClient,
      moduleMaps,
      agentAutonomy,
      appendEvent,
      upsertInstruction,
      sessionEvents,
      recordDelegation,
    ),
    ordem,
    autonomias,
    instrucoes,
    delegacoes,
  };
}

describe('AcceptParallelizationUseCase', () => {
  it('sobe o dev extra e só então registra o aceite no event log', async () => {
    const { useCase, ordem } = build(false);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
    ).resolves.toEqual({ ok: true });

    expect(ordem.indexOf('engine')).toBeLessThan(ordem.indexOf('evento'));
    // A delegação (área dev, ADR 0094) é registrada DEPOIS do evento de
    // aceite — a ativação já é sucesso quando ela é tentada.
    expect(ordem.indexOf('evento')).toBeLessThan(ordem.indexOf('delegacao'));
  });

  it('engine recusando (sem agente base): não grava o evento de aceite', async () => {
    // O event log é imutável — um "paralelização aceita" gravado antes da
    // recusa ficaria no feed para sempre, descrevendo algo que não ocorreu.
    const { useCase, ordem } = build(true);

    await expect(
      useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
    ).rejects.toThrow('409');

    expect(ordem).not.toContain('evento');
  });

  it('seeda instrução e autonomia do dev extra ANTES de subi-lo no engine', async () => {
    // Sem autonomia, decide() cai em require_approval e o "aceite de um
    // clique" viraria três aprovações manuais por task.
    const { useCase, ordem, autonomias, instrucoes } = build(false);

    await useCase.execute('proj-1', 'sess-1', 'api', 'user-1');

    expect(instrucoes).toEqual([
      { agentId: 'dev-api-2', content: expect.stringContaining('dev-api-2') },
    ]);
    expect(autonomias.map((a) => a.type)).toEqual([
      'git_commit',
      'git_push',
      'pr_open',
    ]);
    expect(autonomias.every((a) => a.agentId === 'dev-api-2')).toBe(true);
    expect(autonomias.every((a) => a.mode === 'auto_approve')).toBe(true);

    expect(ordem.indexOf('instrucao')).toBeLessThan(ordem.indexOf('engine'));
    expect(ordem.indexOf('autonomia')).toBeLessThan(ordem.indexOf('engine'));
  });

  it('NUNCA seeda autonomia de git_merge pro dev extra (trava de merge)', async () => {
    const { useCase, autonomias } = build(false);

    await useCase.execute('proj-1', 'sess-1', 'api', 'user-1');

    expect(autonomias.map((a) => a.type)).not.toContain('git_merge');
  });

  it('módulo fora do module_map vigente: seeda autonomia mesmo sem instrução', async () => {
    const { useCase, autonomias, instrucoes } = build(false, {
      moduleFound: false,
    });

    await useCase.execute('proj-1', 'sess-1', 'api', 'user-1');

    expect(instrucoes).toEqual([]);
    expect(autonomias).toHaveLength(3);
  });

  describe('delegação Dev Lead → dev (área dev, ADR 0094)', () => {
    it('registra delegations com area=dev, apontando pro module_map vigente', async () => {
      const { useCase, delegacoes } = build(false, {
        moduleMapEventIds: ['event-antigo', 'event-module-map-vigente'],
      });

      await useCase.execute('proj-1', 'sess-1', 'api', 'user-1');

      expect(delegacoes).toEqual([
        {
          area: 'dev',
          leadAgent: 'dev-lead',
          subagent: 'dev-api-2',
          status: 'completed',
          // O MAIS RECENTE (último da lista, listByTypeForProject ordena por
          // createdAt ASC) — não o primeiro.
          parecerArtifactId: 'event-module-map-vigente',
        },
      ]);
    });

    it('sem artifact.module_map no projeto: NÃO grava com id falso, só loga e segue', async () => {
      const { useCase, ordem, delegacoes } = build(false, {
        moduleMapEventIds: [],
      });

      await expect(
        useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
      ).resolves.toEqual({ ok: true });

      expect(delegacoes).toEqual([]);
      expect(ordem).not.toContain('delegacao');
    });

    it('RecordDelegationUseCase falhando: não derruba a ativação (já é sucesso)', async () => {
      const { useCase } = build(false, { recordDelegationFails: true });

      await expect(
        useCase.execute('proj-1', 'sess-1', 'api', 'user-1'),
      ).resolves.toEqual({ ok: true });
    });
  });
});
