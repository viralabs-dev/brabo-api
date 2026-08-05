import { describe, expect, it } from 'vitest';
import {
  agenteDe,
  formatarDuracao,
  formatarUsd,
  sinaisDeCodigo,
  turnosMudos,
} from '../../scripts/medir-execucao';

/**
 * O instrumento de medição da FASE 13b.
 *
 * A lição da Fase 10 é que métrica anotada à mão não é preenchida — então o
 * script é o instrumento, e o instrumento precisa de teste como qualquer
 * código que decide alguma coisa. Aqui só as funções PURAS: a parte que fala
 * com o banco é exercitada pela execução real.
 */

const USUARIO = 'd623c9c9-1dae-40ed-90f5-4c71ae5b95b6';

let seq = 0;
function bruto(
  type: string,
  actorKind: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  seq += 1;
  return {
    id: `evt-${seq}`,
    sessionId: 's1',
    seq,
    type,
    actorKind,
    actorId,
    payload,
    createdAt: new Date(2026, 7, 4, 12, 0, seq),
  };
}

/** O que o AGENTE escreve: `actorKind: 'agent'` e o slug em `actorId`. */
function evento(
  type: string,
  actorId: string,
  payload: Record<string, unknown> = {},
) {
  return bruto(type, 'agent', actorId, payload);
}

/**
 * `agent.activated` NÃO é escrito pelo agente — é escrito por quem o ativou.
 *
 * O fixture antigo montava esse evento com `actorKind: 'agent'` e o slug em
 * `actorId`, forma que o produto nunca produz; por isso a suite ficava verde
 * enquanto o script marcava todo turno como mudo na execução real. Fixture que
 * mente é o defeito, não o atalho.
 */
function ativacao(agent: string, actorId = USUARIO) {
  return bruto('agent.activated', 'user', actorId, { agent });
}

/**
 * Quem é o agente de um evento: `agent.activated` traz no payload, o resto
 * traz em `actorId`. Errar isso faz o script comparar id de usuário com slug e
 * concluir que TODO agente ficou calado.
 */
describe('agenteDe', () => {
  it('tira o agente do payload na ativação, não do ator', () => {
    expect(agenteDe(ativacao('criativo'))).toBe('criativo');
  });

  it('usa o `actorId` quando quem escreveu foi o agente', () => {
    expect(agenteDe(evento('agent.response', 'po', { content: 'oi' }))).toBe(
      'po',
    );
  });

  it('evento de sistema não pertence a agente nenhum', () => {
    expect(agenteDe(bruto('session.closed', 'system', 'engine'))).toBeNull();
  });
});

describe('turnosMudos', () => {
  it('agente que ativa e responde não é mudo', () => {
    const eventos = [
      ativacao('criativo'),
      evento('agent.response', 'criativo', { content: 'olá' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  it('agente que ativa e não escreve NADA é o defeito que se caça', () => {
    const eventos = [
      ativacao('po'),
      bruto('session.closed', 'system', 'engine'),
    ];

    expect(turnosMudos(eventos).map(agenteDe)).toEqual(['po']);
  });

  /**
   * Falhar em voz alta não é o defeito. O que se procura é o agente que some
   * sem deixar nada escrito — não o que reportou erro.
   */
  it('`agent.error` conta como desfecho', () => {
    const eventos = [
      ativacao('arquiteto'),
      evento('agent.error', 'arquiteto', { message: 'provider fora' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  it('handoff também é desfecho — o agente falou pelo ato de passar adiante', () => {
    const eventos = [
      ativacao('criativo'),
      evento('handoff.offered', 'criativo', { to: 'po' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  /**
   * A janela é por ATOR: a resposta de outro agente no meio não salva quem
   * ficou calado. Era o jeito mais fácil de o defeito passar despercebido.
   */
  it('resposta de OUTRO agente não cobre o silêncio deste', () => {
    const eventos = [
      ativacao('po'),
      evento('agent.response', 'criativo', { content: 'eu falei' }),
    ];

    expect(turnosMudos(eventos).map(agenteDe)).toEqual(['po']);
  });

  it('duas ativações do mesmo agente são julgadas separadamente', () => {
    const eventos = [
      ativacao('po'),
      evento('agent.response', 'po', { content: 'primeira' }),
      ativacao('po'),
      bruto('session.closed', 'system', 'engine'),
    ];

    const mudos = turnosMudos(eventos);
    expect(mudos).toHaveLength(1);
    expect(mudos[0].id).toBe(eventos[2].id);
  });

  /**
   * O caso da execução real: o MESMO usuário ativa três agentes diferentes e
   * todos respondem. Comparando `actorId` dos dois lados, o script acusava três
   * turnos mudos onde não havia nenhum.
   */
  it('ativações do mesmo usuário para agentes diferentes não viram turno mudo', () => {
    const eventos = [
      ativacao('criativo'),
      evento('agent.response', 'criativo', { content: 'regras' }),
      ativacao('po'),
      evento('agent.response', 'po', { content: 'épico' }),
      ativacao('arquiteto'),
      evento('agent.response', 'arquiteto', { content: 'module map' }),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });

  /** Ativação sem agente no payload não dá para julgar — e não vira acusação. */
  it('ativação sem `payload.agent` é ignorada em vez de acusada', () => {
    const eventos = [
      bruto('agent.activated', 'user', USUARIO),
      bruto('session.closed', 'system', 'engine'),
    ];

    expect(turnosMudos(eventos)).toEqual([]);
  });
});

describe('sinaisDeCodigo', () => {
  it('acusa bloco de código, import e nome de arquivo', () => {
    const texto = [
      'Que tal assim:',
      '```ts',
      "import { Hono } from 'hono';",
      '```',
      'coloque em src/server.ts',
    ].join('\n');

    expect(sinaisDeCodigo(texto)).toEqual(
      expect.arrayContaining([
        'bloco de código',
        'import/require',
        'nome de arquivo',
      ]),
    );
  });

  /**
   * O Criativo falando de PRODUTO não pode acender o farol — senão o sinal
   * vira ruído e ninguém olha mais.
   */
  it('conversa de produto não acende nada', () => {
    const texto =
      'O objetivo é que qualquer visitante veja uma saudação. ' +
      'A regra: a resposta precisa ser imediata e não exigir cadastro.';

    expect(sinaisDeCodigo(texto)).toEqual([]);
  });

  it('comando de shell acende', () => {
    expect(sinaisDeCodigo('rode `pnpm install` antes')).toContain(
      'comando de shell',
    );
  });
});

describe('formatação', () => {
  it('duração em segundos, minutos e horas', () => {
    expect(formatarDuracao(12_000)).toBe('12s');
    expect(formatarDuracao(221_000)).toBe('3m41s');
    expect(formatarDuracao(3_720_000)).toBe('1h02m');
  });

  /** Sub-centavo não pode virar `US$ 0,00`: some a diferença que se está medindo. */
  it('gasto abaixo de um centavo não vira zero', () => {
    expect(formatarUsd(0)).toBe('US$ 0,00');
    expect(formatarUsd(1_811)).toBe('< US$ 0,01');
    expect(formatarUsd(1_250_000)).toBe('US$ 1,25');
  });
});
