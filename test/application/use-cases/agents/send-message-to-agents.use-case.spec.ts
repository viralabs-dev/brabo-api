import { describe, it, expect } from 'vitest';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';

// AT-717 (ADR 0247, RN-991): uma mensagem, vários destinatários.
function montar(
  engine: (agente: string) => unknown,
  append?: () => Promise<unknown>,
) {
  const eventos: Array<{ payload: Record<string, unknown> }> = [];
  const chamadas: Array<{ agente: string; mensagemId: unknown }> = [];
  const uc = new SendAgentMessageUseCase(
    {
      sendAgentMessage: (
        _p: string,
        _s: string,
        agente: string,
        _t: string,
        _i: unknown,
        mensagemId: unknown,
      ) => {
        chamadas.push({ agente, mensagemId });
        const r = engine(agente);
        return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
      },
    } as never,
    {
      execute: (_p: string, _s: string, e: { payload: never }) => {
        if (append) return append();
        eventos.push(e);
        return Promise.resolve({ id: 'evt-1' });
      },
    } as never,
    { execute: () => Promise.resolve(null) } as never,
    {
      execute: () => Promise.resolve({ facts: [], factsTotal: 0 }),
    } as never,
    { listByUser: () => Promise.resolve([]) } as never,
    { referencias: () => Promise.resolve([]) } as never,
  );
  return { uc, eventos, chamadas };
}

describe('SendAgentMessageUseCase.executeVarios (RN-991)', () => {
  it('2 destinatários: UM chat.message e duas entregas com o mesmo mensagemId', async () => {
    const { uc, eventos, chamadas } = montar((a) =>
      a === 'po' ? { entrega: 'lida' } : { entrega: 'enfileirada', posicao: 1 },
    );
    const r = await uc.executeVarios('p', 's', ['po', 'arquiteto'], 'oi', 'u');
    expect(eventos).toHaveLength(1);
    expect(eventos[0].payload.destinatarios).toEqual(['po', 'arquiteto']);
    expect(chamadas.map((c) => c.mensagemId)).toEqual(['evt-1', 'evt-1']);
    expect(r).toEqual({
      mensagemId: 'evt-1',
      entregas: [
        { agente: 'po', entrega: 'turno' },
        { agente: 'arquiteto', entrega: 'enfileirada' },
      ],
    });
  });

  it('destinatário recusado pelo engine vira `recusada` sem derrubar o outro', async () => {
    const { uc } = montar((a) =>
      a === 'qa'
        ? new UnprocessableEntityException('qa não recebe mensagem')
        : { entrega: 'lida' },
    );
    const r = await uc.executeVarios('p', 's', ['qa', 'po'], 'oi', 'u');
    expect(r.entregas).toEqual([
      { agente: 'qa', entrega: 'recusada', motivo: 'qa não recebe mensagem' },
      { agente: 'po', entrega: 'turno' },
    ]);
  });

  it('sessão encerrada: o 409 sobe e nada é entregue', async () => {
    const { uc, chamadas } = montar(
      () => ({ entrega: 'lida' }),
      () => Promise.reject(new ConflictException('sessao_encerrada')),
    );
    await expect(
      uc.executeVarios('p', 's', ['po'], 'oi', 'u'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(chamadas).toHaveLength(0);
  });

  it('a rota de um agente só grava destinatarios: [agent]', async () => {
    const { uc, eventos } = montar(() => ({ entrega: 'lida' }));
    await uc.execute('p', 's', 'criativo', 'oi', 'u');
    expect(eventos[0].payload.destinatarios).toEqual(['criativo']);
  });
});
