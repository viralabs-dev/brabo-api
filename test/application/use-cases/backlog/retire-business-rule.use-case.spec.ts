import { describe, it, expect } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { RetireBusinessRuleUseCase } from '../../../../src/application/use-cases/backlog/retire-business-rule.use-case';
import { ListBusinessRulesUseCase } from '../../../../src/application/use-cases/backlog/list-business-rules.use-case';
import { GetCoverageUseCase } from '../../../../src/application/use-cases/backlog/get-coverage.use-case';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { PerguntasEmAbertoUseCase } from '../../../../src/application/use-cases/backlog/perguntas-em-aberto.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type {
  Story,
  Task,
} from '../../../../src/domain/backlog/backlog.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

/** RN-1018 — o agente retira a regra obsoleta. */
const P = 'p1';

const ev = (id: string, type: string, payload: object): SessionEvent => ({
  id,
  sessionId: 's1',
  seq: 1,
  type,
  actor: { kind: 'agent', id: 'criativo' },
  payload,
  createdAt: new Date(),
});

const regra = (id: string) =>
  ev(id, 'artifact.business_rule', { title: `regra ${id}`, description: '' });

const historia = (id: string, ids: string[]): Story =>
  ({
    id,
    projectId: P,
    sessionId: 's1',
    title: `história ${id}`,
    description: 'd',
    rf: [],
    rnf: [],
    dod: [],
    dor: [],
    businessRuleIds: ids,
    status: 'ready',
  }) as unknown as Story;

function montar(opts: {
  historias?: Story[];
  tarefas?: Partial<Task>[];
  respondidas?: string[];
  extras?: SessionEvent[];
}) {
  const eventos: SessionEvent[] = [
    regra('r-velha'),
    regra('r-nova'),
    ...(opts.extras ?? []),
  ];
  const historias = opts.historias ?? [];
  const gravados: SessionEvent[] = [];
  const sessionEvents = {
    listByTypeForProject: (_p: string, type: string) =>
      Promise.resolve(eventos.filter((e) => e.type === type)),
  } as unknown as SessionEventRepository;
  const stories = {
    findByProject: () => Promise.resolve(historias),
    updateContent: (id: string, c: Partial<Story>) => {
      const i = historias.findIndex((s) => s.id === id);
      historias[i] = { ...historias[i], ...c };
      return Promise.resolve(historias[i]);
    },
  } as unknown as StoryRepository;
  const tasks = {
    findByStoryIds: () => Promise.resolve(opts.tarefas ?? []),
  } as unknown as TaskRepository;
  const append = {
    execute: (_p: string, _s: string, input: SessionEvent) => {
      gravados.push(input);
      eventos.push(ev('ret-1', input.type, input.payload as object));
      return Promise.resolve();
    },
  } as unknown as AppendSessionEventUseCase;
  const uow = {
    runInTransaction: <T>(fn: () => Promise<T>) => fn(),
  };
  const perguntas = {
    foiRespondida: (_p: string, q: string) =>
      Promise.resolve((opts.respondidas ?? []).includes(q)),
  } as unknown as PerguntasEmAbertoUseCase;
  return {
    caso: new RetireBusinessRuleUseCase(
      stories,
      tasks,
      sessionEvents,
      append,
      uow,
      perguntas,
    ),
    gravados,
    historias,
    sessionEvents,
    stories,
  };
}

const base = { sessionId: 's1', agentRole: 'criativo', reason: 'obsoleta' };

describe('RetireBusinessRuleUseCase', () => {
  it.each(['arquiteto', 'dev', 'ux-designer'])(
    'o papel %s não retira (403 nomeado) e nada é gravado',
    async (agentRole) => {
      const m = montar({});
      const erro = await m.caso
        .execute(P, 'r-velha', { ...base, agentRole, replacedBy: 'r-nova' })
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ForbiddenException);
      expect((erro as ForbiddenException).getResponse()).toMatchObject({
        reason: 'papel_nao_retira_regra',
      });
      expect(m.gravados).toHaveLength(0);
    },
  );

  it.each(['criativo', 'po'])('o papel %s retira', async (agentRole) => {
    const m = montar({});
    await m.caso.execute(P, 'r-velha', {
      ...base,
      agentRole,
      replacedBy: 'r-nova',
    });
    expect(m.gravados[0]).toMatchObject({
      type: 'artifact.business_rule_retired',
      actor: { kind: 'agent', id: agentRole },
    });
  });

  it('sem replacedBy e sem questionId: 400 retirada_sem_citacao', async () => {
    const m = montar({});
    const erro = await m.caso
      .execute(P, 'r-velha', base)
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).getResponse()).toMatchObject({
      reason: 'retirada_sem_citacao',
    });
  });

  it('questionId de pergunta NÃO respondida: 409; respondida: retira', async () => {
    const m = montar({ respondidas: ['q-ok'] });
    await expect(
      m.caso.execute(P, 'r-velha', { ...base, questionId: 'q-aberta' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await m.caso.execute(P, 'r-velha', { ...base, questionId: 'q-ok' });
    expect(m.gravados[0].payload).toMatchObject({
      ruleId: 'r-velha',
      questionId: 'q-ok',
    });
  });

  it('substituta inexistente, a própria regra ou já retirada: 400', async () => {
    const m = montar({});
    for (const replacedBy of ['nao-existe', 'r-velha']) {
      await expect(
        m.caso.execute(P, 'r-velha', { ...base, replacedBy }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('troca a regra nas histórias (inclusive ready), sem duplicar', async () => {
    const m = montar({
      historias: [
        historia('h1', ['r-velha', 'r-outra']),
        historia('h2', ['r-velha', 'r-nova']),
        historia('h3', ['r-outra']),
      ],
    });
    const out = await m.caso.execute(P, 'r-velha', {
      ...base,
      replacedBy: 'r-nova',
    });
    expect(out.storyIds).toEqual(['h1', 'h2']);
    expect(m.historias.map((s) => s.businessRuleIds)).toEqual([
      ['r-outra', 'r-nova'],
      ['r-nova'],
      ['r-outra'],
    ]);
    expect(m.gravados[0].payload).toMatchObject({
      ruleId: 'r-velha',
      replacedBy: 'r-nova',
      storyIds: ['h1', 'h2'],
    });
  });

  it('recusa quando a história ficaria sem regra e não grava nada', async () => {
    const m = montar({
      historias: [
        historia('h1', ['r-outra', 'r-velha']),
        historia('h2', ['r-velha']),
      ],
      respondidas: ['q-ok'],
    });
    const erro = await m.caso
      .execute(P, 'r-velha', { ...base, questionId: 'q-ok' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'historia_ficaria_sem_regra',
    });
    expect(m.gravados).toHaveLength(0);
    expect(m.historias[0].businessRuleIds).toEqual(['r-outra', 'r-velha']);
  });

  it('só pela resposta, retira quando a história mantém outra regra', async () => {
    const m = montar({
      historias: [historia('h1', ['r-outra', 'r-velha'])],
      respondidas: ['q-ok'],
    });
    await m.caso.execute(P, 'r-velha', { ...base, questionId: 'q-ok' });
    expect(m.historias[0].businessRuleIds).toEqual(['r-outra']);
  });

  it('história com tarefa em execução: 409 e nada é gravado', async () => {
    const m = montar({
      historias: [historia('h1', ['r-velha'])],
      tarefas: [{ storyId: 'h1', status: 'in_progress' }],
    });
    const erro = await m.caso
      .execute(P, 'r-velha', { ...base, replacedBy: 'r-nova' })
      .catch((e: unknown) => e);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'historia_com_tarefa_em_execucao',
    });
    expect(m.gravados).toHaveLength(0);
  });

  it('retirar de novo: 409 regra_ja_retirada', async () => {
    const m = montar({});
    await m.caso.execute(P, 'r-velha', { ...base, replacedBy: 'r-nova' });
    await expect(
      m.caso.execute(P, 'r-velha', { ...base, replacedBy: 'r-nova' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('os leitores ignoram a regra retirada (lista e cobertura)', async () => {
    const m = montar({ historias: [historia('h1', ['r-velha'])] });
    await m.caso.execute(P, 'r-velha', { ...base, replacedBy: 'r-nova' });

    const lista = await new ListBusinessRulesUseCase(
      m.sessionEvents,
      m.stories,
    ).execute(P);
    expect(lista.rules.map((r) => r.id)).toEqual(['r-nova']);
    expect(lista.rules[0].coveredByStoryIds).toEqual(['h1']);

    const cobertura = await new GetCoverageUseCase(
      m.sessionEvents,
      m.stories,
    ).execute(P);
    expect(cobertura.rules.map((r) => r.ruleId)).toEqual(['r-nova']);
  });
});
