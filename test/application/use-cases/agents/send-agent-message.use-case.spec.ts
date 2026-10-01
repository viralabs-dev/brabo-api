import { describe, it, expect, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { SendAgentMessageUseCase } from '../../../../src/application/use-cases/agents/send-agent-message.use-case';

const semFatos = {
  execute: () => Promise.resolve({ facts: [], factsTotal: 0 }),
};

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
    entrega: unknown = { entrega: 'lida' },
  ) {
    const ids: Array<string | null | undefined> = [];
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
        return Promise.resolve({ id: 'evt-1' });
      },
    };
    const engine = {
      sendAgentMessage: (
        _p: string,
        _s: string,
        _a: string,
        _t: string,
        idiomaDaResposta?: string | null,
        mensagemId?: string | null,
      ) => {
        ordem.push('engine');
        enviados.push(idiomaDaResposta);
        ids.push(mensagemId);
        return recusa ? Promise.reject(recusa) : Promise.resolve(entrega);
      },
    };
    const resolver = { execute: vi.fn(idioma) };
    const uc = new SendAgentMessageUseCase(
      engine as never,
      appendEvent as never,
      resolver as never,
      semFatos as never,
    );
    return { uc, eventos, ordem, enviados, resolver, ids };
  }

  it('aceite: grava o chat.message e depois pergunta ao engine, com o id dele', async () => {
    const { uc, eventos, ordem, ids } = montar();
    await expect(uc.execute('p', 's', 'po', 'oi', 'u')).resolves.toEqual({
      ok: true,
      mensagemId: 'evt-1',
      entrega: 'lida',
    });
    expect(ordem).toEqual(['append', 'engine']);
    expect(eventos.map((e) => e.type)).toEqual(['chat.message']);
    // RN-673: o id do chat.message vai ao engine — é por ele que a mensagem
    // que entrar na fila é marcada entregue ou cancelada.
    expect(ids).toEqual(['evt-1']);
  });

  // RN-673 (ADR 0191): com turno em curso a mensagem entra na fila do agente,
  // e a resposta diz isso — nunca mais 409 `turno_em_andamento`.
  it('turno em curso: a resposta diz que a mensagem entrou na fila, e em que posição', async () => {
    const { uc } = montar(undefined, undefined, {
      entrega: 'enfileirada',
      posicao: 2,
    });
    await expect(uc.execute('p', 's', 'po', 'Continue', 'u')).resolves.toEqual({
      ok: true,
      mensagemId: 'evt-1',
      entrega: 'enfileirada',
      posicao: 2,
    });
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
          return Promise.resolve({ entrega: 'lida' });
        },
      } as never,
      {
        execute: (
          _p: string,
          _s: string,
          e: { payload: Record<string, unknown> },
        ) => {
          eventos.push(e);
          return Promise.resolve({ id: 'evt-2' });
        },
      } as never,
      resolver as never,
      semFatos as never,
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
      mensagemId: 'evt-2',
      entrega: 'lida',
    });
    expect(enviados).toEqual([null]);
    expect(eventos[0].payload).toEqual({ text: 'oi' });
  });
});

// RN-680 (ADR 0196): os fatos do perfil do AUTOR neste projeto viajam com a
// mensagem até o engine; o chat.message registra QUANTOS foram.
describe('SendAgentMessageUseCase — fatos do perfil (RN-680)', () => {
  function montar(contexto: () => Promise<unknown>) {
    const eventos: Array<{ payload: Record<string, unknown> }> = [];
    const perfis: Array<string | null | undefined> = [];
    const leitor = { execute: vi.fn(contexto) };
    const uc = new SendAgentMessageUseCase(
      {
        sendAgentMessage: (
          _p: string,
          _s: string,
          _a: string,
          _t: string,
          _i?: string | null,
          perfil?: string | null,
        ) => {
          perfis.push(perfil);
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
      { execute: () => Promise.reject(new Error('sem idioma')) } as never,
      leitor as never,
    );
    return { uc, eventos, perfis, leitor };
  }

  it('lê pelo AUTOR e pelo PROJETO, e manda o texto ao engine', async () => {
    const { uc, eventos, perfis, leitor } = montar(() =>
      Promise.resolve({
        facts: [
          {
            hypothesisId: 'h1',
            agenteAlvo: 'po',
            hipotese: 'prefere uma pergunta por vez',
            sugestao: 'perguntar uma coisa de cada vez',
            aceitoEm: '2026-10-01T10:00:00.000Z',
          },
        ],
        factsTotal: 1,
      }),
    );

    await uc.execute('proj-1', 's', 'po', 'oi', 'autor-1');

    expect(leitor.execute).toHaveBeenCalledWith({
      userId: 'autor-1',
      projectId: 'proj-1',
    });
    expect(perfis[0]).toContain('prefere uma pergunta por vez');
    expect(eventos[0].payload).toEqual({ text: 'oi', fatosDoPerfil: 1 });
  });

  it('grafo fora do ar não derruba a mensagem: vai sem perfil', async () => {
    const { uc, eventos, perfis } = montar(() =>
      Promise.reject(new Error('Neo4j fora do ar')),
    );

    await expect(uc.execute('p', 's', 'po', 'oi', 'u')).resolves.toEqual({
      ok: true,
    });
    expect(perfis).toEqual([null]);
    expect(eventos[0].payload).toEqual({ text: 'oi' });
  });
});
