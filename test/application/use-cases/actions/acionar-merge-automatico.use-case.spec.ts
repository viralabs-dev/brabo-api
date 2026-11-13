import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AcionarMergeAutomaticoUseCase } from '../../../../src/application/use-cases/actions/acionar-merge-automatico.use-case';

const prAberta = (n = '7') => ({
  actionType: 'pr_open',
  seq: 1,
  status: 'executed',
  payload: { storyTaskId: 't1' },
  executionResult: { kind: 'pr_open', pullRequestId: n },
});

function montar(
  o: {
    chave?: boolean;
    task?: object | null;
    prs?: object[];
    merges?: object[];
  } = {},
) {
  const propose = vi
    .fn()
    .mockResolvedValue({ id: 'a1', status: 'auto_approved' });
  const uc = new AcionarMergeAutomaticoUseCase(
    {
      findById: () =>
        Promise.resolve({ id: 'p1', mergeAutomatico: o.chave ?? true }),
    } as never,
    {
      findInProjectByIds: () =>
        Promise.resolve(
          o.task === null
            ? []
            : [
                {
                  id: 't1',
                  gateStatus: 'awaiting_user',
                  blocked: false,
                  archivedAt: null,
                  ...o.task,
                },
              ],
        ),
    } as never,
    {
      listByProjectAndType: (_p: string, tipo: string) =>
        Promise.resolve(
          tipo === 'pr_open' ? (o.prs ?? [prAberta()]) : (o.merges ?? []),
        ),
    } as never,
    { execute: propose } as never,
  );
  return { uc, propose };
}

const recusa = async (p: Promise<unknown>, code: string) => {
  const e = (await p.catch((x: unknown) => x)) as ConflictException;
  expect(e).toBeInstanceOf(ConflictException);
  expect((e.getResponse() as { code: string }).code).toBe(code);
};

describe('AcionarMergeAutomaticoUseCase (RN-1316)', () => {
  it('caminho feliz: propõe git_merge com a origem do gatilho, na branch de trabalho', async () => {
    const { uc, propose } = montar();
    await uc.execute('p1', 't1', 's1');
    expect(propose).toHaveBeenCalledWith('p1', 's1', {
      actionType: 'git_merge',
      actor: { kind: 'system', id: 'merge_automatico' },
      payload: { pullRequestId: '7', targetBranch: 'main', storyTaskId: 't1' },
      origem: 'merge_automatico',
    });
  });

  it('chave desligada: 409 chave_desligada e nada é proposto', async () => {
    const { uc, propose } = montar({ chave: false });
    await recusa(uc.execute('p1', 't1', 's1'), 'chave_desligada');
    expect(propose).not.toHaveBeenCalled();
  });

  it('gate pendente ou tarefa bloqueada: 409 gate_pendente', async () => {
    await recusa(
      montar({ task: { gateStatus: 'awaiting_secops' } }).uc.execute(
        'p1',
        't1',
        's1',
      ),
      'gate_pendente',
    );
    await recusa(
      montar({ task: { gateStatus: null } }).uc.execute('p1', 't1', 's1'),
      'gate_pendente',
    );
    await recusa(
      montar({ task: { blocked: true } }).uc.execute('p1', 't1', 's1'),
      'gate_pendente',
    );
  });

  it('sem PR aberta: 409 sem_pr', async () => {
    await recusa(montar({ prs: [] }).uc.execute('p1', 't1', 's1'), 'sem_pr');
  });

  it('PR já mergeada ou já proposta: 409 nomeado (RN-663)', async () => {
    const merge = (status: string, executionResult: object | null) => ({
      id: 'm1',
      actionType: 'git_merge',
      status,
      payload: { pullRequestId: '7' },
      executionResult,
    });
    await recusa(
      montar({
        merges: [
          merge('executed', {
            kind: 'git_merge',
            state: 'merged',
            pullRequestId: '7',
          }),
        ],
      }).uc.execute('p1', 't1', 's1'),
      'pr_ja_mergeado',
    );
    await recusa(
      montar({ merges: [merge('pending', null)] }).uc.execute('p1', 't1', 's1'),
      'merge_ja_proposto',
    );
  });

  it('tarefa de outro projeto: 404', async () => {
    await expect(
      montar({ task: null }).uc.execute('p1', 't1', 's1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
