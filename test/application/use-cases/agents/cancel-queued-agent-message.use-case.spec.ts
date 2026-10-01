import { describe, it, expect, vi } from 'vitest';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CancelQueuedAgentMessageUseCase } from '../../../../src/application/use-cases/agents/cancel-queued-agent-message.use-case';

// RN-673 (ADR 0191): a mensagem que espera na fila de um agente pode ser
// cancelada por QUEM A ENVIOU. A api confere existência, autoria e sessão
// aberta; quem decide se ela ainda está na fila é o engine.
describe('CancelQueuedAgentMessageUseCase (RN-673)', () => {
  function montar(
    evento: unknown,
    opcoes: { engine?: () => Promise<void>; sessao?: () => Promise<void> } = {},
  ) {
    const engine = {
      cancelQueuedMessage: vi.fn(opcoes.engine ?? (() => Promise.resolve())),
    };
    const appendEvent = {
      garantirQueAceita: vi.fn(opcoes.sessao ?? (() => Promise.resolve())),
    };
    const uc = new CancelQueuedAgentMessageUseCase(
      { findById: () => Promise.resolve(evento) } as never,
      appendEvent as never,
      engine as never,
    );
    return { uc, engine, appendEvent };
  }

  const mensagemDe = (userId: string, sessionId = 's1') => ({
    id: 'evt-1',
    sessionId,
    seq: 7,
    type: 'chat.message',
    actor: { kind: 'user', id: userId },
    payload: { text: 'Continue' },
  });

  it('quem enviou cancela: confere a sessão aberta e pede ao engine', async () => {
    const { uc, engine, appendEvent } = montar(mensagemDe('u-1'));

    await expect(uc.execute('p1', 's1', 'po', 'evt-1', 'u-1')).resolves.toEqual(
      {
        ok: true,
      },
    );
    expect(appendEvent.garantirQueAceita).toHaveBeenCalledWith(
      'p1',
      's1',
      'chat.message_cancelled',
      { kind: 'user', id: 'u-1' },
    );
    expect(engine.cancelQueuedMessage).toHaveBeenCalledWith(
      'p1',
      's1',
      'po',
      'evt-1',
      'u-1',
    );
  });

  it('a mensagem de OUTRA pessoa: 403 nomeado, e o engine não é chamado', async () => {
    const { uc, engine } = montar(mensagemDe('outra'));

    const erro = await uc
      .execute('p1', 's1', 'po', 'evt-1', 'u-1')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ForbiddenException);
    expect((erro as ForbiddenException).getResponse()).toMatchObject({
      reason: 'mensagem_de_outra_pessoa',
    });
    expect(engine.cancelQueuedMessage).not.toHaveBeenCalled();
  });

  it('mensagem de outra sessão, ou que não é chat.message: 404', async () => {
    await expect(
      montar(mensagemDe('u-1', 'outra-sessao')).uc.execute(
        'p1',
        's1',
        'po',
        'evt-1',
        'u-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      montar({ ...mensagemDe('u-1'), type: 'agent.response' }).uc.execute(
        'p1',
        's1',
        'po',
        'evt-1',
        'u-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    await expect(
      montar(null).uc.execute('p1', 's1', 'po', 'evt-1', 'u-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('já lida pelo agente: a recusa 409 do engine é repassada sem ser engolida', async () => {
    const { uc } = montar(mensagemDe('u-1'), {
      engine: () =>
        Promise.reject(
          new ConflictException('Esta mensagem não está mais na fila'),
        ),
    });

    await expect(
      uc.execute('p1', 's1', 'po', 'evt-1', 'u-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sessão encerrada: a recusa da RN-581 vem antes do engine', async () => {
    const { uc, engine } = montar(mensagemDe('u-1'), {
      sessao: () => Promise.reject(new ConflictException('sessao_encerrada')),
    });

    await expect(
      uc.execute('p1', 's1', 'po', 'evt-1', 'u-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(engine.cancelQueuedMessage).not.toHaveBeenCalled();
  });
});
