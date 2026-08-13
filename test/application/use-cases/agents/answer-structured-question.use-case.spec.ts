import { describe, expect, it, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AnswerStructuredQuestionUseCase } from '../../../../src/application/use-cases/agents/answer-structured-question.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const PROJECT = 'p1';
const SESSION = 's1';
const QUESTION_SET_ID = 'evt-perguntas';

/**
 * RN-162: submissão do formulário de `chat.structured_question` — grava
 * `chat.structured_question_answered` e reenvia as respostas ao agente pelo
 * MESMO caminho de `SendAgentMessageUseCase`, reusado (não reinventado).
 */
function build(opts?: {
  questionSetEvent?: Partial<SessionEvent> | null;
  respostasExistentes?: SessionEvent[];
}) {
  const eventosGravados: { type: string; payload: unknown }[] = [];
  const mensagensEnviadas: { agent: string; text: string }[] = [];

  const questionSetEvent: SessionEvent | null =
    opts?.questionSetEvent === undefined
      ? {
          id: QUESTION_SET_ID,
          sessionId: SESSION,
          seq: 3,
          type: 'chat.structured_question',
          actor: { kind: 'agent', id: 'criativo' },
          payload: {
            questions: [
              { id: 'nome', label: 'Qual o nome do produto?' },
              {
                id: 'plataforma',
                label: 'Qual plataforma?',
                type: 'select',
                options: ['Web', 'Mobile'],
              },
            ],
          },
          createdAt: new Date(),
        }
      : (opts.questionSetEvent as SessionEvent | null);

  const sessionEvents = {
    findById: (_id: string) => Promise.resolve(questionSetEvent),
    listByTypeInSession: (_sessionId: string, _type: string) =>
      Promise.resolve(opts?.respostasExistentes ?? []),
  } as unknown as SessionEventRepository;

  const appendEvent = {
    execute: (_p: string, _s: string, e: { type: string; payload: unknown }) => {
      eventosGravados.push(e);
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  const sendAgentMessage = {
    execute: (
      _p: string,
      _s: string,
      agent: string,
      text: string,
      _userId: string,
    ) => {
      mensagensEnviadas.push({ agent, text });
      return Promise.resolve({ ok: true as const });
    },
  } as unknown as SendAgentMessageUseCase;

  return {
    useCase: new AnswerStructuredQuestionUseCase(
      sessionEvents,
      appendEvent,
      sendAgentMessage,
    ),
    eventosGravados,
    mensagensEnviadas,
  };
}

describe('AnswerStructuredQuestionUseCase', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('grava chat.structured_question_answered com o questionSetId e as respostas', async () => {
    await ctx.useCase.execute(
      PROJECT,
      SESSION,
      'criativo',
      QUESTION_SET_ID,
      { nome: 'Checkout Fácil', plataforma: 'Web' },
      'user-1',
    );

    expect(ctx.eventosGravados).toEqual([
      {
        type: 'chat.structured_question_answered',
        actor: { kind: 'user', id: 'user-1' },
        payload: {
          questionSetId: QUESTION_SET_ID,
          answers: { nome: 'Checkout Fácil', plataforma: 'Web' },
        },
      },
    ]);
  });

  it('reenvia as respostas concatenadas ao agente via SendAgentMessageUseCase', async () => {
    await ctx.useCase.execute(
      PROJECT,
      SESSION,
      'criativo',
      QUESTION_SET_ID,
      { nome: 'Checkout Fácil', plataforma: 'Web' },
      'user-1',
    );

    expect(ctx.mensagensEnviadas).toEqual([
      {
        agent: 'criativo',
        text:
          '1. Qual o nome do produto?: Checkout Fácil\n' +
          '2. Qual plataforma?: Web',
      },
    ]);
  });

  it('conjunto de perguntas inexistente devolve 404', async () => {
    const semPerguntas = build({ questionSetEvent: null });

    await expect(
      semPerguntas.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        'evt-inexistente',
        { nome: 'x' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('evento que não é chat.structured_question devolve 404 (não deixa responder qualquer id)', async () => {
    const eventoErrado = build({
      questionSetEvent: {
        id: QUESTION_SET_ID,
        sessionId: SESSION,
        seq: 1,
        type: 'chat.message',
        actor: { kind: 'user', id: 'user-1' },
        payload: {},
        createdAt: new Date(),
      },
    });

    await expect(
      eventoErrado.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        QUESTION_SET_ID,
        { nome: 'x' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('evento de OUTRA sessão devolve 404', async () => {
    const outraSessao = build({
      questionSetEvent: {
        id: QUESTION_SET_ID,
        sessionId: 'outra-sessao',
        seq: 1,
        type: 'chat.structured_question',
        actor: { kind: 'agent', id: 'criativo' },
        payload: { questions: [] },
        createdAt: new Date(),
      },
    });

    await expect(
      outraSessao.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        QUESTION_SET_ID,
        {},
        'user-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('já respondido: recusa com 409, e NÃO grava evento nem reenvia mensagem', async () => {
    const jaRespondido = build({
      respostasExistentes: [
        {
          id: 'evt-resposta',
          sessionId: SESSION,
          seq: 4,
          type: 'chat.structured_question_answered',
          actor: { kind: 'user', id: 'user-1' },
          payload: { questionSetId: QUESTION_SET_ID, answers: {} },
          createdAt: new Date(),
        },
      ],
    });

    await expect(
      jaRespondido.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        QUESTION_SET_ID,
        { nome: 'x', plataforma: 'Web' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(jaRespondido.eventosGravados).toEqual([]);
    expect(jaRespondido.mensagensEnviadas).toEqual([]);
  });

  it('resposta faltando para uma pergunta: recusa com 400', async () => {
    await expect(
      ctx.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        QUESTION_SET_ID,
        { nome: 'Checkout Fácil' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(ctx.eventosGravados).toEqual([]);
    expect(ctx.mensagensEnviadas).toEqual([]);
  });

  it('resposta vazia (só espaços) conta como faltando', async () => {
    await expect(
      ctx.useCase.execute(
        PROJECT,
        SESSION,
        'criativo',
        QUESTION_SET_ID,
        { nome: '   ', plataforma: 'Web' },
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
