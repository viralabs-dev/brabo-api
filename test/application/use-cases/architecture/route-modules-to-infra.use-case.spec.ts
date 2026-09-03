import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RouteModulesToInfraUseCase } from '../../../../src/application/use-cases/architecture/route-modules-to-infra.use-case';
import { GetModuleRoutingUseCase } from '../../../../src/application/use-cases/architecture/get-module-routing.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type {
  ModuleMap,
  ModuleNode,
} from '../../../../src/domain/architecture/module-map.entity';
import { EVENTO_MODULE_ROUTING } from '../../../../src/domain/architecture/module-routing';

const PROJETO = 'proj-1';
const SESSAO = 'sess-1';

function mod(name: string): ModuleNode {
  return { name, stack: 'ts', responsibility: name, dependsOn: [] };
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

/** Mesmo desenho de `create-c4-diagram.use-case.spec.ts`: o event log falso é
 * o REGISTRO do artefato (não há tabela — ADR 0131). */
function montar(
  opts: { moduleMap?: ModuleMap | null; eventosIniciais?: SessionEvent[] } = {},
) {
  const eventos = [...(opts.eventosIniciais ?? [])];
  let seq = eventos.length;

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
        createdAt: new Date('2026-09-01T00:00:00Z'),
      };
      eventos.push(evento);
      return Promise.resolve(evento);
    },
  } as unknown as AppendSessionEventUseCase;

  const moduleMaps = {
    findCurrent: () => Promise.resolve(opts.moduleMap ?? null),
  };

  const getModuleRouting = new GetModuleRoutingUseCase(sessionEvents);
  const routeModulesToInfra = new RouteModulesToInfraUseCase(
    moduleMaps as never,
    append,
    getModuleRouting,
  );

  return { getModuleRouting, routeModulesToInfra, eventos };
}

const IMAGEM_VALIDA = 'node:22-bookworm-slim';
const PORQUE_VALIDO = 'Módulo TypeScript sobre Node 22 — só o runtime.';

describe('GetModuleRoutingUseCase — leitura sem tabela', () => {
  it('projeto novo nasce `sem_roteamento`', async () => {
    const { getModuleRouting } = montar();
    const estado = await getModuleRouting.execute(PROJETO);

    expect(estado.status).toBe('sem_roteamento');
    expect(estado.roteamento).toEqual([]);
    expect(estado.version).toBe(0);
  });

  it('o vigente é o de maior version — rotear de novo é revisão, não apagamento', async () => {
    const { getModuleRouting, routeModulesToInfra } = montar({
      moduleMap: moduleMap([mod('api')]),
    });
    await routeModulesToInfra.execute(PROJETO, SESSAO, {
      roteamento: [
        {
          modulo: 'api',
          imagemCandidata: IMAGEM_VALIDA,
          porque: PORQUE_VALIDO,
        },
      ],
    });
    await routeModulesToInfra.execute(PROJETO, SESSAO, {
      roteamento: [
        {
          modulo: 'api',
          imagemCandidata: 'node:22.5-bookworm-slim',
          porque: PORQUE_VALIDO,
        },
      ],
    });

    const estado = await getModuleRouting.execute(PROJETO);
    expect(estado.version).toBe(2);
    expect(estado.roteamento[0].imagemCandidata).toBe(
      'node:22.5-bookworm-slim',
    );
  });
});

describe('RouteModulesToInfraUseCase', () => {
  it('caminho feliz: um item por módulo, emite artifact.module_routing com o Arquiteto como autor', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api'), mod('web')]),
    });

    const resultado = await routeModulesToInfra.execute(PROJETO, SESSAO, {
      roteamento: [
        {
          modulo: 'api',
          imagemCandidata: IMAGEM_VALIDA,
          porque: PORQUE_VALIDO,
        },
        {
          modulo: 'web',
          imagemCandidata: 'node:22-bookworm-slim',
          porque: 'Front-end React sobre o mesmo runtime do backend.',
        },
      ],
    });

    expect(resultado.version).toBe(1);
    expect(resultado.roteamento).toHaveLength(2);

    const evento = eventos.at(-1)!;
    expect(evento.type).toBe(EVENTO_MODULE_ROUTING);
    expect(evento.actor).toEqual({ kind: 'agent', id: 'arquiteto' });
    expect(evento.payload).toMatchObject({ version: 1 });
  });

  it('sem module_map vigente, recusa com 400 e não grava nada', async () => {
    const { routeModulesToInfra, eventos } = montar({ moduleMap: null });

    await expect(
      routeModulesToInfra.execute(PROJETO, SESSAO, {
        roteamento: [
          {
            modulo: 'api',
            imagemCandidata: IMAGEM_VALIDA,
            porque: PORQUE_VALIDO,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('lista vazia recusa com 400', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await expect(
      routeModulesToInfra.execute(PROJETO, SESSAO, { roteamento: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('módulo repetido na lista recusa com 400', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await expect(
      routeModulesToInfra.execute(PROJETO, SESSAO, {
        roteamento: [
          {
            modulo: 'api',
            imagemCandidata: IMAGEM_VALIDA,
            porque: PORQUE_VALIDO,
          },
          {
            modulo: 'api',
            imagemCandidata: IMAGEM_VALIDA,
            porque: PORQUE_VALIDO,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('módulo fora do module_map vigente recusa com 400 nomeando os válidos', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    let erro: unknown;
    try {
      await routeModulesToInfra.execute(PROJETO, SESSAO, {
        roteamento: [
          {
            modulo: 'modulo-que-nao-existe',
            imagemCandidata: IMAGEM_VALIDA,
            porque: PORQUE_VALIDO,
          },
        ],
      });
    } catch (e) {
      erro = e;
    }

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toContain('api');
    expect(eventos).toHaveLength(0);
  });

  it('imagem `latest` recusa com 400 — delegado a validarDecisaoDeImagem', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await expect(
      routeModulesToInfra.execute(PROJETO, SESSAO, {
        roteamento: [
          {
            modulo: 'api',
            imagemCandidata: 'node:latest',
            porque: PORQUE_VALIDO,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('rationale curto recusa com 400 — delegado a validarDecisaoDeImagem', async () => {
    const { routeModulesToInfra, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await expect(
      routeModulesToInfra.execute(PROJETO, SESSAO, {
        roteamento: [
          { modulo: 'api', imagemCandidata: IMAGEM_VALIDA, porque: 'curto' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });
});
