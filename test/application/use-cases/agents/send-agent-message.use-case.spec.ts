import { describe, it, expect, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';

// RN-587 (AT-132). A api grava o chat.message ANTES de perguntar ao engine
// (o engine lê o log; a mensagem tem de ser durável com ele fora do ar). A
// recusa do engine é o ÚNICO validador do destinatário — a api não tem lista
// própria — e é o ENGINE quem grava o agent.error ao lado. Aqui se fixa o
// contrato da api: grava primeiro, repassa a recusa sem engolir e sem
// escrever um segundo evento (duplicaria o do engine).
describe('SendAgentMessageUseCase (RN-587)', () => {
  function montar(
    recusa?: Error,
    idioma: () => Promise<unknown> = () =>
      Promise.resolve({ idioma: 'pt-BR', origem: 'conta' }),
  ) {
    const eventos: Array<{ type: string; payload?: Record<string, unknown> }> =
      [];
    const ordem: string[] = [];
    const enviados: Array<string | null | undefined> = [];
    const appendEvent = {
      execute: (
        _p: string,
        _s: string,
        e: { type: string; payload?: Record<string, unknown> },
      ) => {
        eventos.push(e);
        ordem.push('append');
        return Promise.resolve();
      },
    };
    const engine = {
      sendAgentMessage: (
        _p: string,
        _s: string,
        _a: string,
        _t: string,
        idiomaDaResposta?: string | null,
      ) => {
        ordem.push('engine');
        enviados.push(idiomaDaResposta);
        return recusa ? Promise.reject(recusa) : Promise.resolve();
      },
    };
    const resolver = { execute: vi.fn(idioma) };
    const uc = new SendAgentMessageUseCase(
      engine as never,
      appendEvent as never,
      resolver as never,
    );
    return { uc, eventos, ordem, enviados, resolver };
  }

  it('aceite: grava o chat.message e depois pergunta ao engine', async () => {
    const { uc, eventos, ordem } = montar();
    await expect(uc.execute('p', 's', 'po', 'oi', 'u')).resolves.toEqual({
      ok: true,
    });
    expect(ordem).toEqual(['append', 'engine']);
    expect(eventos.map((e) => e.type)).toEqual(['chat.message']);
  });

  it('recusa 422 do engine: repassada, e a api não grava evento próprio', async () => {
    const { uc, eventos } = montar(
      new UnprocessableEntityException('nenhum agente a leu'),
    );
    await expect(
      uc.execute('p', 's', 'infra', 'oi', 'u'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(eventos.map((e) => e.type)).toEqual(['chat.message']);
  });
});

// RN-622 (AT-164): o idioma do AUTOR, resolvido na sessão dele, viaja com a
// mensagem até o engine, e o chat.message o registra para a medição.
describe('SendAgentMessageUseCase — idioma da resposta (RN-622)', () => {
  function montar(idioma: () => Promise<unknown>) {
    const eventos: Array<{ payload: Record<string, unknown> }> = [];
    const enviados: Array<string | null | undefined> = [];
    const resolver = { execute: vi.fn(idioma) };
    const uc = new SendAgentMessageUseCase(
      {
        sendAgentMessage: (
          _p: string,
          _s: string,
          _a: string,
          _t: string,
          i?: string | null,
        ) => {
          enviados.push(i);
          return Promise.resolve();
        },
      } as never,
      {
        execute: (
          _p: string,
          _s: string,
          e: { payload: Record<string, unknown> },
        ) => {
          eventos.push(e);
          return Promise.resolve();
        },
      } as never,
      resolver as never,
    );
    return { uc, eventos, enviados, resolver };
  }

  it('resolve pelo AUTOR e pela SESSÃO (o override dela vence a conta) e manda ao engine', async () => {
    const { uc, eventos, enviados, resolver } = montar(() =>
      Promise.resolve({ idioma: 'es-MX', origem: 'sessao' }),
    );

    await uc.execute('p', 'sessao-1', 'po', 'hola', 'autor-1');

    expect(resolver.execute).toHaveBeenCalledWith('autor-1', 'sessao-1');
    expect(enviados).toEqual(['es-MX']);
    expect(eventos[0].payload).toEqual({
      text: 'hola',
      idiomaAlvo: 'es-MX',
      origem: 'sessao',
    });
  });

  it('a resolução que falha não derruba a mensagem: vai sem idioma, e o chat.message sem os campos', async () => {
    const { uc, eventos, enviados } = montar(() =>
      Promise.reject(new Error('banco fora')),
    );

    await expect(uc.execute('p', 's', 'po', 'oi', 'u')).resolves.toEqual({
      ok: true,
    });
    expect(enviados).toEqual([null]);
    expect(eventos[0].payload).toEqual({ text: 'oi' });
  });
});
