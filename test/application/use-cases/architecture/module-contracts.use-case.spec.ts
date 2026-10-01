import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { DeclareModuleContractsUseCase } from '../../../../src/application/use-cases/architecture/declare-module-contracts.use-case';
import { GetModuleContractsUseCase } from '../../../../src/application/use-cases/architecture/get-module-contracts.use-case';
import { ListModuleContractsUseCase } from '../../../../src/application/use-cases/architecture/list-module-contracts.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type {
  ModuleMap,
  ModuleNode,
} from '../../../../src/domain/architecture/module-map.entity';
import {
  EVENTO_MODULE_CONTRACTS,
  MAX_ITENS_POR_MODULO,
  validarContratos,
} from '../../../../src/domain/architecture/module-contracts';

/**
 * RN-684 (ADR 0200): o contrato entre módulos é artefato versionado do
 * Arquiteto, e é o que o dev agent lê em vez de abrir o worktree alheio.
 * Mesmo desenho de `route-modules-to-infra.use-case.spec.ts`: o event log
 * falso é o REGISTRO do artefato (não há tabela).
 */
const PROJETO = 'proj-1';
const SESSAO = 'sess-1';

function mod(name: string, dependsOn: string[] = []): ModuleNode {
  return { name, stack: 'ts', responsibility: name, dependsOn };
}

function moduleMap(modules: ModuleNode[]): ModuleMap {
  return {
    id: 'mm-1',
    projectId: PROJETO,
    sessionId: SESSAO,
    modules,
    version: 1,
    createdAt: new Date(),
  };
}

const MAPA = moduleMap([
  mod('board-engine'),
  mod('scoring'),
  mod('game-session', ['board-engine', 'scoring']),
]);

function montar(opts: { moduleMap?: ModuleMap | null } = {}) {
  const eventos: SessionEvent[] = [];
  let seq = 0;

  const sessionEvents = {
    listByTypeForProject: (_projectId: string, type: string) =>
      Promise.resolve(eventos.filter((e) => e.type === type)),
  } as unknown as SessionEventRepository;

  const append = {
    execute: (
      _p: string,
      sessionId: string,
      input: {
        type: string;
        actor: { kind: string; id: string };
        payload: unknown;
      },
    ) => {
      seq += 1;
      const evento: SessionEvent = {
        id: `evt-${seq}`,
        sessionId,
        seq,
        type: input.type,
        actor: input.actor as SessionEvent['actor'],
        payload: input.payload,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      };
      eventos.push(evento);
      return Promise.resolve(evento);
    },
  } as unknown as AppendSessionEventUseCase;

  const moduleMaps = {
    findCurrent: () =>
      Promise.resolve(opts.moduleMap === undefined ? MAPA : opts.moduleMap),
  };

  const get = new GetModuleContractsUseCase(sessionEvents);
  const declare = new DeclareModuleContractsUseCase(
    moduleMaps as never,
    append,
    get,
  );
  const list = new ListModuleContractsUseCase(moduleMaps as never, get);
  return { declare, list, eventos };
}

const BOARD = {
  modulo: 'board-engine',
  expoe: [
    {
      tipo: 'funcao',
      assinatura: 'placePiece(board, piece, pos): Board',
      descricao: 'Nunca muta o board recebido.',
    },
  ],
};

describe('validarContratos (domínio)', () => {
  it('normaliza e aceita um contrato bem formado', () => {
    const [c] = validarContratos([
      {
        modulo: ' board-engine ',
        expoe: [{ tipo: 'rota', assinatura: ' GET /board ' }],
      },
    ]);
    expect(c).toEqual({
      modulo: 'board-engine',
      expoe: [{ tipo: 'rota', assinatura: 'GET /board', descricao: '' }],
    });
  });

  it.each([
    [[], 'Lista vazia'],
    [[{ modulo: '', expoe: BOARD.expoe }], 'não tem `modulo`'],
    [[BOARD, BOARD], 'mais de uma vez'],
    [[{ modulo: 'board-engine', expoe: [] }], '`expoe` está vazio'],
    [
      [
        {
          modulo: 'board-engine',
          expoe: [{ tipo: 'classe', assinatura: 'X' }],
        },
      ],
      '`tipo` inválido ("classe")',
    ],
    [
      [
        {
          modulo: 'board-engine',
          expoe: [{ tipo: 'funcao', assinatura: ' ' }],
        },
      ],
      '`assinatura` é obrigatória',
    ],
    [
      [
        {
          modulo: 'board-engine',
          expoe: [{ tipo: 'funcao', assinatura: 'a'.repeat(301) }],
        },
      ],
      'o teto é 300',
    ],
    [
      [
        {
          modulo: 'board-engine',
          expoe: Array.from({ length: MAX_ITENS_POR_MODULO + 1 }, () => ({
            tipo: 'funcao',
            assinatura: 'f()',
          })),
        },
      ],
      `o teto é ${MAX_ITENS_POR_MODULO}`,
    ],
  ])('recusa %#, nomeando o motivo', (entrada, motivo) => {
    expect(() => validarContratos(entrada as never)).toThrow(motivo);
  });
});

describe('DeclareModuleContractsUseCase', () => {
  it('grava artifact.module_contracts, versão 1, autor arquiteto', async () => {
    const { declare, eventos } = montar();

    const r = await declare.execute(PROJETO, SESSAO, { contratos: [BOARD] });

    expect(r.version).toBe(1);
    expect(eventos).toHaveLength(1);
    expect(eventos[0].type).toBe(EVENTO_MODULE_CONTRACTS);
    expect(eventos[0].actor).toEqual({ kind: 'agent', id: 'arquiteto' });
    expect(eventos[0].payload).toEqual({ contratos: r.contratos, version: 1 });
  });

  it('mudar o contrato é nova versão, e a vigente SUBSTITUI a anterior', async () => {
    const { declare, list } = montar();
    await declare.execute(PROJETO, SESSAO, { contratos: [BOARD] });

    const r = await declare.execute(PROJETO, SESSAO, {
      contratos: [
        {
          modulo: 'scoring',
          expoe: [{ tipo: 'evento', assinatura: 'score.changed {total}' }],
        },
      ],
    });
    expect(r.version).toBe(2);

    const lido = await list.execute(PROJETO);
    expect(lido.version).toBe(2);
    // board-engine sumiu da v2: o vigente substitui, não acumula.
    expect(lido.modulos.find((m) => m.modulo === 'board-engine')?.expoe).toBe(
      null,
    );
    expect(lido.modulos.find((m) => m.modulo === 'scoring')?.expoe).toEqual([
      { tipo: 'evento', assinatura: 'score.changed {total}', descricao: '' },
    ]);
  });

  it('recusa módulo fora do module_map, listando os válidos', async () => {
    const { declare, eventos } = montar();
    const p = declare.execute(PROJETO, SESSAO, {
      contratos: [{ ...BOARD, modulo: 'renderer' }],
    });
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(
      'Os módulos válidos são: board-engine, scoring, game-session.',
    );
    expect(eventos).toHaveLength(0);
  });

  it('recusa sem module_map vigente', async () => {
    const { declare, eventos } = montar({ moduleMap: null });
    await expect(
      declare.execute(PROJETO, SESSAO, { contratos: [BOARD] }),
    ).rejects.toThrow('create_module_map');
    expect(eventos).toHaveLength(0);
  });

  it('recusa de domínio vira 400 com a mensagem que volta ao modelo', async () => {
    const { declare } = montar();
    await expect(
      declare.execute(PROJETO, SESSAO, { contratos: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ListModuleContractsUseCase (o que o dev lê)', () => {
  it('sem contrato: um item por módulo do mapa, expoe null, consumo do dependsOn', async () => {
    const { list } = montar();
    const lido = await list.execute(PROJETO);

    expect(lido.status).toBe('sem_contratos');
    expect(lido.version).toBe(0);
    expect(lido.modulos).toEqual([
      { modulo: 'board-engine', dependeDe: [], expoe: null },
      { modulo: 'scoring', dependeDe: [], expoe: null },
      {
        modulo: 'game-session',
        dependeDe: ['board-engine', 'scoring'],
        expoe: null,
      },
    ]);
    expect(lido.contratosForaDoMapa).toEqual([]);
  });

  it('contrato de módulo que saiu do mapa é DITO, nunca atribuído', async () => {
    const vivo = montar();
    await vivo.declare.execute(PROJETO, SESSAO, { contratos: [BOARD] });

    // O mapa foi revisado e board-engine saiu dele.
    const semBoard = moduleMap([
      mod('scoring'),
      mod('game-session', ['scoring']),
    ]);
    const list = new ListModuleContractsUseCase(
      { findCurrent: () => Promise.resolve(semBoard) } as never,
      new GetModuleContractsUseCase({
        listByTypeForProject: () => Promise.resolve(vivo.eventos),
      } as never),
    );

    const lido = await list.execute(PROJETO);
    expect(lido.modulos.map((m) => m.modulo)).toEqual([
      'scoring',
      'game-session',
    ]);
    expect(lido.contratosForaDoMapa).toEqual(['board-engine']);
  });

  it('sem module_map: lista vazia, sem lançar', async () => {
    const { list } = montar({ moduleMap: null });
    const lido = await list.execute(PROJETO);
    expect(lido.modulos).toEqual([]);
  });
});
