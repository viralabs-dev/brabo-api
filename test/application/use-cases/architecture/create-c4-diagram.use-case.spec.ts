import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateC4DiagramUseCase } from '../../../../src/application/use-cases/architecture/create-c4-diagram.use-case';
import { GetC4DiagramUseCase } from '../../../../src/application/use-cases/architecture/get-c4-diagram.use-case';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type {
  ModuleMap,
  ModuleNode,
} from '../../../../src/domain/architecture/module-map.entity';
import { EVENTO_C4_DIAGRAM } from '../../../../src/domain/architecture/c4-diagram';

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

/**
 * Mesmo desenho de `container-do-projeto.use-case.spec.ts`: o event log falso
 * é o REGISTRO do artefato (não há tabela — ADR 0065, estendido aqui).
 */
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
        createdAt: new Date('2026-08-11T00:00:00Z'),
      };
      eventos.push(evento);
      return Promise.resolve(evento);
    },
  } as unknown as AppendSessionEventUseCase;

  const moduleMaps = {
    findCurrent: () => Promise.resolve(opts.moduleMap ?? null),
  };

  const getC4Diagram = new GetC4DiagramUseCase(sessionEvents);
  const createC4Diagram = new CreateC4DiagramUseCase(
    moduleMaps as never,
    append,
    getC4Diagram,
  );

  return { getC4Diagram, createC4Diagram, eventos };
}

describe('GetC4DiagramUseCase — leitura sem tabela', () => {
  it('projeto novo nasce `sem_diagrama`', async () => {
    const { getC4Diagram } = montar();
    const estado = await getC4Diagram.execute(PROJETO);

    expect(estado.status).toBe('sem_diagrama');
    expect(estado.diagrama).toBeNull();
    expect(estado.version).toBe(0);
  });

  it('depois de gerado, o estado é `gerado` com o diagrama', async () => {
    const { getC4Diagram, createC4Diagram } = montar({
      moduleMap: moduleMap([mod('api')]),
    });
    await createC4Diagram.execute(PROJETO, SESSAO, { systemName: 'Brabo' });

    const estado = await getC4Diagram.execute(PROJETO);
    expect(estado.status).toBe('gerado');
    expect(estado.diagrama?.systemName).toBe('Brabo');
    expect(estado.diagrama?.containerDiagram).toContain('"api"');
    expect(estado.version).toBe(1);
  });

  it('o vigente é o de maior `version` — revisar é gerar de novo', async () => {
    const { getC4Diagram, createC4Diagram } = montar({
      moduleMap: moduleMap([mod('api')]),
    });
    await createC4Diagram.execute(PROJETO, SESSAO, { systemName: 'Brabo v1' });
    await createC4Diagram.execute(PROJETO, SESSAO, { systemName: 'Brabo v2' });

    const estado = await getC4Diagram.execute(PROJETO);
    expect(estado.version).toBe(2);
    expect(estado.diagrama?.systemName).toBe('Brabo v2');
  });
});

describe('CreateC4DiagramUseCase', () => {
  it('sem module_map vigente, recusa com 400 e não grava nada', async () => {
    const { createC4Diagram, eventos } = montar({ moduleMap: null });

    await expect(
      createC4Diagram.execute(PROJETO, SESSAO, { systemName: 'Brabo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('entrada inválida (sem system_name) recusa com 400 antes de tocar o module_map', async () => {
    const { createC4Diagram, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await expect(
      createC4Diagram.execute(PROJETO, SESSAO, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(eventos).toHaveLength(0);
  });

  it('emite `artifact.c4_diagram` com o Arquiteto como autor', async () => {
    const { createC4Diagram, eventos } = montar({
      moduleMap: moduleMap([mod('api'), mod('web', ['api'])]),
    });

    await createC4Diagram.execute(PROJETO, SESSAO, {
      systemName: 'Brabo',
      systemDescription: 'Plataforma de agentes',
      actors: [{ name: 'Usuário' }],
    });

    const evento = eventos.at(-1)!;
    expect(evento.type).toBe(EVENTO_C4_DIAGRAM);
    expect(evento.actor).toEqual({ kind: 'agent', id: 'arquiteto' });
    expect(evento.payload).toMatchObject({ systemName: 'Brabo', version: 1 });
  });

  it('o Container level reflete o module_map — dois módulos e a dependência', async () => {
    const { createC4Diagram } = montar({
      moduleMap: moduleMap([mod('api'), mod('web', ['api'])]),
    });

    const { diagrama } = await createC4Diagram.execute(PROJETO, SESSAO, {
      systemName: 'Brabo',
    });

    expect(diagrama.containerDiagram).toContain('"api"');
    expect(diagrama.containerDiagram).toContain('"web"');
    expect(diagrama.containerDiagram).toContain('"depende de"');
  });

  it('gerar de novo versiona (2) e preserva a versão anterior no log', async () => {
    const { createC4Diagram, eventos } = montar({
      moduleMap: moduleMap([mod('api')]),
    });

    await createC4Diagram.execute(PROJETO, SESSAO, { systemName: 'Brabo' });
    const { version } = await createC4Diagram.execute(PROJETO, SESSAO, {
      systemName: 'Brabo',
    });

    expect(version).toBe(2);
    expect(eventos.filter((e) => e.type === EVENTO_C4_DIAGRAM)).toHaveLength(2);
  });
});
