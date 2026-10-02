import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { ExecuteExecutionPlanUseCase } from '../../../../src/application/use-cases/execution/execute-execution-plan.use-case';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

// AT-263/AT-274 (RN-677/RN-678, ADR 0194): aprovar o plano do Dev Lead grava
// o módulo de cada tarefa e ATIVA a execução pelo mesmo caso de uso do botão.
const T1 = '11111111-1111-4111-8111-111111111111';
const now = new Date();

function acao(
  payload: Record<string, unknown>,
  decidedBy: string | null = 'maint-1',
): ProposedAction {
  return {
    id: 'act-plano',
    projectId: 'proj-1',
    sessionId: 'sess-dev-lead',
    seq: 1,
    actionType: 'propose_execution_plan',
    payload,
    status: decidedBy ? 'approved' : 'auto_approved',
    resolvedPolicy: 'require_approval',
    actor: { kind: 'agent', id: 'dev-lead' },
    decidedBy,
    decidedAt: decidedBy ? now : null,
    rejectionReason: null,
    executionResult: null,
    createdAt: now,
    updatedAt: now,
  };
}

const PLANO_BOM = {
  resumo: 'um por módulo',
  modulos: [{ modulo: 'board-engine', agentes: 1, porque: 'x' }],
  tarefas: [{ taskId: T1, modulo: 'board-engine' }],
};

function harness(
  opts: { ativacaoFalha?: Error; sessaoCriadaPor?: string } = {},
) {
  const resultados: Array<{ status: string; executionResult: unknown }> = [];
  const eventos: Array<{ type: string; payload: unknown }> = [];
  const atribuicoes: unknown[] = [];
  const activate = vi.fn((_projectId: string, _userId: string) =>
    opts.ativacaoFalha
      ? Promise.reject(opts.ativacaoFalha)
      : Promise.resolve({
          sessionId: 'sess-exec',
          modules: ['board-engine'],
        }),
  );
  const useCase = new ExecuteExecutionPlanUseCase(
    { runInTransaction: (w: () => Promise<unknown>) => w() } as never,
    {
      updateExecutionResult: (
        _id: string,
        u: { status: string; executionResult: unknown },
      ) => {
        resultados.push(u);
        return Promise.resolve({
          ...acao(PLANO_BOM),
          status: u.status,
          executionResult: u.executionResult,
        });
      },
    } as never,
    { append: () => Promise.resolve() } as never,
    {
      execute: (
        _p: string,
        _s: string,
        e: { type: string; payload: unknown },
      ) => {
        eventos.push(e);
        return Promise.resolve({});
      },
    } as never,
    {
      findCurrent: () =>
        Promise.resolve({
          modules: [{ name: 'board-engine' }, { name: 'input-keyboard' }],
        }),
    } as never,
    {
      findInProjectByIds: (_p: string, ids: string[]) =>
        Promise.resolve(ids.filter((id) => id === T1).map((id) => ({ id }))),
      assignModules: (a: unknown[]) => {
        atribuicoes.push(...a);
        return Promise.resolve();
      },
    } as never,
    {
      findInProject: () =>
        Promise.resolve(
          opts.sessaoCriadaPor ? { createdBy: opts.sessaoCriadaPor } : null,
        ),
    } as never,
    { execute: activate } as never,
  );
  return { useCase, resultados, eventos, atribuicoes, activate };
}

describe('ExecuteExecutionPlanUseCase (RN-677/RN-678)', () => {
  it('aprovado: atribui o módulo das tarefas, ativa a execução como QUEM APROVOU e fica executed', async () => {
    const h = harness();
    const out = await h.useCase.execute(
      'proj-1',
      'sess-dev-lead',
      acao(PLANO_BOM),
    );

    expect(h.atribuicoes).toEqual([{ taskId: T1, module: 'board-engine' }]);
    // Quem aprovou ativa; sem `originSessionId` — a sessão do Dev Lead fica.
    // AT-381 (RN-709): só o módulo com tarefa sobe agente.
    expect(h.activate).toHaveBeenCalledWith(
      'proj-1',
      'maint-1',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['board-engine'],
    );
    expect(out.status).toBe('executed');
    expect(h.resultados[0]).toEqual({
      status: 'executed',
      executionResult: {
        sessaoDeExecucao: 'sess-exec',
        modulos: ['board-engine'],
        tarefasAtribuidas: 1,
        tarefasPorModulo: { 'board-engine': 1 },
        modulosSemTarefa: ['input-keyboard'],
      },
    });
    expect(h.eventos.map((e) => e.type)).toEqual(['execution.plan_applied']);
  });

  it('auto-aprovado (sem decisor): quem ativa é quem abriu a sessão', async () => {
    const h = harness({ sessaoCriadaPor: 'dono-da-sessao' });
    await h.useCase.execute('proj-1', 'sess-dev-lead', acao(PLANO_BOM, null));
    expect(h.activate.mock.calls[0]?.slice(0, 2)).toEqual([
      'proj-1',
      'dono-da-sessao',
    ]);
  });

  it('módulo fora do module_map na APROVAÇÃO: failed com motivo, nada gravado, nada ativado', async () => {
    const h = harness();
    const out = await h.useCase.execute(
      'proj-1',
      'sess-dev-lead',
      acao({ ...PLANO_BOM, tarefas: [{ taskId: T1, modulo: 'audio' }] }),
    );
    expect(out.status).toBe('failed');
    expect(h.atribuicoes).toEqual([]);
    expect(h.activate).not.toHaveBeenCalled();
    expect(
      (h.resultados[0].executionResult as { motivo: string }).motivo,
    ).toContain('"audio"');
    expect(h.eventos.map((e) => e.type)).toEqual(['execution.plan_failed']);
  });

  it('ativação recusada (409 sem repositório, RN-582): failed com a FRASE da api', async () => {
    const h = harness({
      ativacaoFalha: new ConflictException(
        'Sem repositório: aceite o handoff ao Arquiteto.',
      ),
    });
    const out = await h.useCase.execute(
      'proj-1',
      'sess-dev-lead',
      acao(PLANO_BOM),
    );
    expect(out.status).toBe('failed');
    expect(h.resultados[0].executionResult).toMatchObject({
      sessaoDeExecucao: null,
      motivo: 'Sem repositório: aceite o handoff ao Arquiteto.',
    });
  });

  it('recusaNaProposta: tarefa sem módulo devolve o motivo; plano bom devolve null', async () => {
    const h = harness();
    expect(await h.useCase.recusaNaProposta('proj-1', PLANO_BOM)).toBeNull();
    expect(
      await h.useCase.recusaNaProposta('proj-1', {
        ...PLANO_BOM,
        tarefas: [{ taskId: T1 }],
      }),
    ).toContain('sem módulo');
  });
});
