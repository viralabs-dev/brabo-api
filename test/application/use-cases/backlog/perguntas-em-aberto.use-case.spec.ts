import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PerguntasEmAbertoUseCase } from '../../../../src/application/use-cases/backlog/perguntas-em-aberto.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import { validarPerguntaEmAberto } from '../../../../src/domain/open-questions/pergunta-em-aberto';

/**
 * RN-858 (AT-521, ADR 0214): a pergunta em aberto de agente, a fila do
 * projeto e a resposta — só do autor da sessão, uma vez, virando
 * `decision_record` e religando o gate estacionado da tarefa afetada.
 */
const Q = '11111111-2222-4333-8444-555555555555';

let eventos: SessionEvent[];
let resumeParkedGate: ReturnType<typeof vi.fn>;
let useCase: PerguntasEmAbertoUseCase;

function pergunta(over: Record<string, unknown> = {}): SessionEvent {
  return {
    id: 'ev-q',
    sessionId: 's-origem',
    seq: 1,
    type: 'artifact.open_question',
    actor: { kind: 'agent', id: 'criativo' },
    payload: {
      questionId: Q,
      pergunta: 'Código inexistente responde 404?',
      sugestao: '404 com mensagem curta',
      afeta: { regras: [], historias: ['st-1'], tarefas: ['t-1'] },
      autor: 'criativo',
      sessionId: 's-origem',
      ...over,
    },
    createdAt: new Date(1000),
  };
}

beforeEach(() => {
  eventos = [pergunta()];
  resumeParkedGate = vi.fn(() => Promise.resolve());
  let n = 0;
  const sessionEvents = {
    listByTypeForProject: (projectId: string, tipo: string) =>
      Promise.resolve(
        projectId === 'p1' ? eventos.filter((e) => e.type === tipo) : [],
      ),
  } as unknown as SessionEventRepository;
  const sessions = {
    findInProject: (_p: string, id: string) =>
      Promise.resolve(id === 's-origem' ? { createdBy: 'autor' } : null),
  } as unknown as SessionRepository;
  const append = {
    execute: (
      _p: string,
      sessionId: string,
      e: { type: string; actor: SessionEvent['actor']; payload: unknown },
    ) => {
      const ev: SessionEvent = {
        id: `ev-${++n}`,
        sessionId,
        seq: n + 1,
        createdAt: new Date(2000 + n),
        ...e,
      };
      eventos.push(ev);
      return Promise.resolve(ev);
    },
  } as unknown as AppendSessionEventUseCase;
  useCase = new PerguntasEmAbertoUseCase(
    sessionEvents,
    sessions,
    append,
    { runInTransaction: <T>(w: () => Promise<T>) => w() },
    { resumeParkedGate } as unknown as ApiToEngineClient,
  );
});

describe('PerguntasEmAbertoUseCase (RN-858)', () => {
  it('lista a aberta com quem pode responder; respondida sai do filtro open', async () => {
    const lista = await useCase.listar('p1', 'open');
    expect(lista.total).toBe(1);
    expect(lista.itens[0]).toMatchObject({
      questionId: Q,
      autor: 'criativo',
      status: 'open',
      autorDaSessao: 'autor',
    });
    await useCase.responder('p1', Q, 'autor', { resposta: '404' });
    expect((await useCase.listar('p1', 'open')).total).toBe(0);
    expect((await useCase.listar('p1', 'answered')).itens[0].status).toBe(
      'answered',
    );
  });

  it('o autor responde: decision_record (ator usuário, com questionId) e answered, e o gate é religado', async () => {
    const r = await useCase.responder('p1', Q, 'autor', { resposta: ' 404 ' });
    const decisao = eventos.find((e) => e.type === 'artifact.decision_record')!;
    expect(decisao.actor).toEqual({ kind: 'user', id: 'autor' });
    expect(decisao.sessionId).toBe('s-origem');
    expect(decisao.payload).toMatchObject({
      context: 'Código inexistente responde 404?',
      choice: '404',
      questionId: Q,
      afeta: { historias: ['st-1'], tarefas: ['t-1'] },
    });
    const fechou = eventos.find((e) => e.type === 'open_question.answered')!;
    expect(fechou.payload).toEqual({
      questionId: Q,
      resposta: '404',
      aceitouSugestao: false,
      decisionEventId: decisao.id,
      respondidaPor: 'autor',
    });
    expect(r.status).toBe('answered');
    expect(resumeParkedGate).toHaveBeenCalledWith('p1', 't-1', 'qa');
  });

  it('aceitar a sugestão grava a sugestão como escolha', async () => {
    await useCase.responder('p1', Q, 'autor', { aceitarSugestao: true });
    const fechou = eventos.find((e) => e.type === 'open_question.answered')!;
    expect(fechou.payload).toMatchObject({
      resposta: '404 com mensagem curta',
      aceitouSugestao: true,
    });
  });

  it('gate que não estava estacionado não desfaz a resposta', async () => {
    resumeParkedGate.mockRejectedValueOnce(new Error('gate_nao_estacionado'));
    const r = await useCase.responder('p1', Q, 'autor', { resposta: '404' });
    expect(r.status).toBe('answered');
  });

  it('quem não é o autor da sessão recebe 403 so_o_autor_da_sessao, sem escrever', async () => {
    const erro = await useCase
      .responder('p1', Q, 'outro', { resposta: '404' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({
      reason: 'so_o_autor_da_sessao',
    });
    expect(eventos).toHaveLength(1);
  });

  it('já respondida é 409 pergunta_ja_respondida', async () => {
    await useCase.responder('p1', Q, 'autor', { resposta: '404' });
    const erro = await useCase
      .responder('p1', Q, 'autor', { resposta: '410' })
      .catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'pergunta_ja_respondida',
    });
  });

  it('pergunta de outro projeto é 404', async () => {
    await expect(
      useCase.responder('p2', Q, 'autor', { resposta: '404' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('aceitar sugestão que não existe, ou resposta vazia, é 400', async () => {
    eventos = [pergunta({ sugestao: undefined })];
    await expect(
      useCase.responder('p1', Q, 'autor', { aceitarSugestao: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      useCase.responder('p1', Q, 'autor', { resposta: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('artifact.open_question: o payload do contrato (RN-858)', () => {
  it('aceita o contrato e recusa questionId que não é uuid ou pergunta longa', () => {
    expect(validarPerguntaEmAberto(pergunta().payload).ok).toBe(true);
    expect(
      validarPerguntaEmAberto(pergunta({ questionId: 'x' }).payload),
    ).toMatchObject({
      ok: false,
    });
    expect(
      validarPerguntaEmAberto(pergunta({ pergunta: 'x'.repeat(501) }).payload),
    ).toMatchObject({ ok: false });
  });

  it('o funil de eventos recusa com 400 antes de qualquer escrita', async () => {
    const naoDeviaEscrever = () => {
      throw new Error('escreveu');
    };
    const funil = new AppendSessionEventUseCase(
      { runInTransaction: naoDeviaEscrever } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      Promise.resolve().then(() =>
        funil.execute('p1', 's1', {
          type: 'artifact.open_question',
          actor: { kind: 'agent', id: 'po' },
          payload: { questionId: 'nao-uuid' },
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
