import { describe, expect, it } from 'vitest';
import { EscalarModeloDaTarefaUseCase } from '../../../../src/application/use-cases/execution/escalar-modelo-da-tarefa.use-case';
import type { TaskModelEscalation } from '../../../../src/application/ports/task-model-escalation-repository.port';

const HAIKU = 'claude-haiku-5-5';
const SONNET = 'claude-sonnet-5';

function build(modeloAtual: string, opts: { engineFalha?: boolean } = {}) {
  const log: string[] = [];
  let linha: TaskModelEscalation | null = null;
  const estado = {
    registrarBloqueio: (taskId: string, projectId: string, agentId: string) => {
      linha = {
        taskId,
        projectId,
        agentId,
        limitBlocks: (linha?.limitBlocks ?? 0) + 1,
        escalated: linha?.escalated ?? false,
        baseModelId: linha?.baseModelId ?? null,
        baseRoutingPreference: null,
      };
      return Promise.resolve(linha);
    },
    marcarEscalada: (_: string, base: { modelId: string | null }) => {
      linha = {
        ...(linha as TaskModelEscalation),
        limitBlocks: 0,
        escalated: true,
        baseModelId: base.modelId,
      };
      return Promise.resolve();
    },
    find: () => Promise.resolve(linha),
    remove: () => {
      linha = null;
      return Promise.resolve();
    },
  };
  const uc = new EscalarModeloDaTarefaUseCase(
    {
      findById: () =>
        Promise.resolve({
          createdBy: 'u1',
          modelEscalation: null,
          taskBudgetMicros: 700_000,
        }),
    } as never,
    estado,
    { execute: () => Promise.resolve({ modelId: modeloAtual }) } as never,
    {
      findOne: () => Promise.resolve(null),
      remove: () => {
        log.push('binding_removido');
        return Promise.resolve(true);
      },
      upsert: () => Promise.resolve(),
    } as never,
    {
      execute: (_s: string, _k: string, modelId: string) => {
        log.push(`binding:${modelId}`);
        return Promise.resolve();
      },
    } as never,
    {
      setTaskBudget: (_p: string, n: number) => {
        log.push(`teto:${n}`);
        return opts.engineFalha
          ? Promise.reject(new Error('x'))
          : Promise.resolve();
      },
    } as never,
    {
      execute: () => {
        log.push('desbloqueou');
        return Promise.resolve();
      },
    } as never,
    {
      execute: (_p: string, _s: string, ev: { type: string }) => {
        log.push(ev.type);
        return Promise.resolve();
      },
    } as never,
  );
  return { uc, log };
}

describe('EscalarModeloDaTarefaUseCase (RN-1143/RN-1144)', () => {
  it('1º bloqueio só conta; 2º sobe Haiku → Sonnet com o teto do degrau e desbloqueia', async () => {
    const { uc, log } = build(HAIKU);
    expect(await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x')).toBe(
      'contado',
    );
    expect(log).toEqual([]);
    expect(await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x')).toBe(
      'escalado',
    );
    expect(log).toEqual([
      `binding:${SONNET}`,
      'teto:2000000',
      'agent.model_escalated',
      'desbloqueou',
    ]);
  });

  it('último degrau: não escala e registra escada esgotada', async () => {
    const { uc, log } = build(SONNET);
    await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x');
    expect(await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x')).toBe(
      'escada_esgotada',
    );
    expect(log).toEqual(['agent.model_escalation_exhausted']);
  });

  it('falha do engine no teto não desfaz a escalada', async () => {
    const { uc, log } = build(HAIKU, { engineFalha: true });
    await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x');
    expect(await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x')).toBe(
      'escalado',
    );
    expect(log).toContain('desbloqueou');
  });

  it('tarefa fechada volta ao base (remove o binding) e ao teto do projeto', async () => {
    const { uc, log } = build(HAIKU);
    await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x');
    await uc.aoBloquearPorLimite('p', 's', 't', 'dev-x');
    log.length = 0;
    await uc.restaurar('p', 't');
    expect(log).toEqual(['binding_removido', 'teto:700000']);
    await uc.restaurar('p', 't');
    expect(log).toHaveLength(2);
  });
});
