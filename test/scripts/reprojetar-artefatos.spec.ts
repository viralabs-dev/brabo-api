import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from 'ulid';
import { createTestDb, truncateAll } from '../support/test-db';
import {
  outboxEvents,
  projects,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../src/db/schema';
import {
  ProjetoInexistenteError,
  lerArgumentos,
  reprojetarArtefatos,
} from '../../src/scripts/reprojetar-artefatos';
import { ArtifactProjector } from '../../src/application/artifact-projection/artifact-projector';
import { ARTIFACT_PROJECTION_AGGREGATE_TYPE } from '../../src/domain/artifacts/artifact-projection-events';
import { DrizzleOutboxRepository } from '../../src/infrastructure/persistence/drizzle/outbox.repository';
import { DrizzleSessionEventRepository } from '../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleProjectRepository } from '../../src/infrastructure/persistence/drizzle/project.repository';
import { FsArtifactFileStore } from '../../src/infrastructure/filesystem/fs-artifact-file-store';
import { ArtifactFileStore } from '../../src/application/ports/artifact-file-store.port';

/**
 * A reprojeção da pasta `docs/` a partir do event log (RN-590).
 *
 * Prova o que distingue *reconstruiu* de *rodou sem erro*: a pasta que o
 * projetor PARA FRENTE produz é lida (caminho -> conteúdo), APAGADA,
 * reprojetada e lida de novo — e uma segunda reprojeção por cima dá a mesma
 * pasta. Postgres de verdade (banco por worker) e disco de verdade (um tmp por
 * teste, via `PROJECT_WORKSPACES_ROOT`).
 */

const { db, pool } = createTestDb();
const silencio = { progresso: () => {}, reportarFalha: () => {} };

let raiz: string;
let raizAnterior: string | undefined;

beforeEach(async () => {
  await truncateAll(db);
  raizAnterior = process.env.PROJECT_WORKSPACES_ROOT;
  raiz = await mkdtemp(join(tmpdir(), 'brabo-reprojetar-artefatos-'));
  process.env.PROJECT_WORKSPACES_ROOT = raiz;
});

afterEach(async () => {
  if (raizAnterior === undefined) delete process.env.PROJECT_WORKSPACES_ROOT;
  else process.env.PROJECT_WORKSPACES_ROOT = raizAnterior;
  await rm(raiz, { recursive: true, force: true });
});

afterAll(async () => {
  await pool.end();
});

interface Cenario {
  projetoA: string;
  projetoB: string;
}

/**
 * Semeia o event log como `AppendSessionEventUseCase` o deixa: o evento e, na
 * mesma forma, a linha `artifact_projection` da outbox (`aggregateId` é o
 * PROJETO).
 *
 * - projeto A: uma decisão, duas VERSÕES de c4 (só a última pode sobrar), duas
 *   notas de MESMO título (o `seq` é o desempate), e um `qa_verdict` (fora da
 *   lista de permitidos — não pode virar arquivo)
 * - projeto B: uma nota
 */
async function semear(): Promise<Cenario> {
  const sufixo = randomBytes(6).toString('hex');
  const [dono] = await db
    .insert(users)
    .values({
      keycloakSub: `sub-art-${sufixo}`,
      email: `art-${sufixo}@brabo.dev`,
    })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: `acme-${sufixo}`, createdBy: dono.id })
    .returning();
  const [projetoA, projetoB] = await db
    .insert(projects)
    .values([
      {
        workspaceId: ws.id,
        name: 'a',
        slug: `a-${sufixo}`,
        workspaceDirName: `a-${sufixo}`,
        createdBy: dono.id,
      },
      {
        workspaceId: ws.id,
        name: 'b',
        slug: `b-${sufixo}`,
        workspaceDirName: `b-${sufixo}`,
        createdBy: dono.id,
      },
    ])
    .returning();

  async function sessao(
    projectId: string,
    eventos: { type: string; actorId: string; payload: unknown }[],
  ): Promise<void> {
    const [s] = await db
      .insert(sessions)
      .values({
        projectId,
        createdBy: dono.id,
        status: 'active',
        nextSeq: eventos.length + 1,
      })
      .returning();
    for (const [i, e] of eventos.entries()) {
      const id = ulid();
      await db.insert(sessionEvents).values({
        id,
        sessionId: s.id,
        seq: i + 1,
        type: e.type,
        actorKind: 'agent',
        actorId: e.actorId,
        payload: e.payload,
      });
      if (e.type.startsWith('artifact.') && e.type !== 'artifact.qa_verdict') {
        await db.insert(outboxEvents).values({
          aggregateType: ARTIFACT_PROJECTION_AGGREGATE_TYPE,
          aggregateId: projectId,
          eventType: e.type,
          payload: { eventId: id },
        });
      }
    }
  }

  await sessao(projetoA.id, [
    {
      type: 'artifact.decision_record',
      actorId: 'arquiteto',
      payload: { choice: 'Cache em Redis' },
    },
    {
      type: 'artifact.c4_diagram',
      actorId: 'arquiteto',
      payload: { version: 1, nome: 'v1' },
    },
    {
      type: 'artifact.c4_diagram',
      actorId: 'arquiteto',
      payload: { version: 2, nome: 'v2' },
    },
    { type: 'artifact.note', actorId: 'po', payload: { title: 'Igual' } },
    { type: 'artifact.note', actorId: 'po', payload: { title: 'Igual' } },
    {
      type: 'artifact.qa_verdict',
      actorId: 'qa-lead',
      payload: { verdict: 'approved' },
    },
  ]);
  await sessao(projetoB.id, [
    { type: 'artifact.note', actorId: 'po', payload: { title: 'Outra' } },
  ]);

  return { projetoA: projetoA.id, projetoB: projetoB.id };
}

async function projetarParaFrente(): Promise<void> {
  const projector = new ArtifactProjector(
    new DrizzleOutboxRepository(db),
    new DrizzleSessionEventRepository(db),
    new DrizzleProjectRepository(db),
    new FsArtifactFileStore(),
  );
  await projector.drainOnce();
}

/** caminho relativo à raiz -> conteúdo. É a "medida" da pasta. */
async function ler(
  pasta: string,
  base = pasta,
): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  let entradas: Dirent[];
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) Object.assign(saida, await ler(caminho, base));
    else
      saida[caminho.slice(base.length + 1)] = await readFile(caminho, 'utf-8');
  }
  return saida;
}

describe('reprojetarArtefatos (RN-590)', () => {
  it('apaga a pasta, reprojeta o log e chega à MESMA pasta do projetor para frente; a segunda rodada não muda nada', async () => {
    const c = await semear();
    await projetarParaFrente();
    const paraFrente = await ler(raiz);

    // 1 decisão + c4 (um arquivo só) + 2 notas do mesmo título + 1 nota do B.
    expect(Object.keys(paraFrente)).toHaveLength(5);
    const c4 = Object.entries(paraFrente).find(([k]) =>
      k.endsWith('c4_diagram.md'),
    );
    expect(c4?.[1]).toContain('"nome": "v2"');
    expect(Object.keys(paraFrente).some((k) => k.includes('qa_verdict'))).toBe(
      false,
    );

    await rm(raiz, { recursive: true, force: true });
    await mkdir(raiz, { recursive: true });
    expect(await ler(raiz)).toEqual({});

    const outboxAntes = await db.select().from(outboxEvents);

    // Lote de 2 força a varredura a atravessar vários lotes pelo cursor.
    const primeira = await reprojetarArtefatos(db, {
      ...silencio,
      tamanhoDoLote: 2,
    });
    // O c4 v1 também é projetado (e sobrescrito pelo v2): 6 eventos.
    expect(primeira).toMatchObject({ artefatosProjetados: 6, falhas: 0 });
    expect(await ler(raiz)).toEqual(paraFrente);

    const segunda = await reprojetarArtefatos(db, { ...silencio });
    expect(segunda).toEqual(primeira);
    expect(await ler(raiz)).toEqual(paraFrente);

    // Não toca a outbox do projetor vivo.
    expect(await db.select().from(outboxEvents)).toEqual(outboxAntes);
    expect(c.projetoA).not.toEqual(c.projetoB);
  });

  it('nunca apaga: arquivo que já estava em docs/ continua lá', async () => {
    await semear();
    await projetarParaFrente();
    const alheio = join(raiz, (await readdir(raiz))[0], 'docs', 'meu.md');
    await writeFile(alheio, 'do usuário', 'utf-8');

    await reprojetarArtefatos(db, { ...silencio });

    expect(await readFile(alheio, 'utf-8')).toBe('do usuário');
  });

  it('por projeto: reprojeta só o projeto pedido', async () => {
    const c = await semear();
    const r = await reprojetarArtefatos(db, {
      ...silencio,
      projectId: c.projetoB,
    });
    expect(r).toMatchObject({ artefatosProjetados: 1, falhas: 0 });
    expect(Object.keys(await ler(raiz))).toHaveLength(1);
  });

  it('projeto inexistente é recusado com nome, sem gravar nada — caso de falha', async () => {
    await semear();
    await expect(
      reprojetarArtefatos(db, {
        ...silencio,
        projectId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(ProjetoInexistenteError);
    await expect(
      reprojetarArtefatos(db, { ...silencio, projectId: 'nao-e-uuid' }),
    ).rejects.toBeInstanceOf(ProjetoInexistenteError);
    expect(await ler(raiz)).toEqual({});
  });

  it('falha de escrita é contada e nomeada, e não aborta o resto — caso de falha', async () => {
    await semear();
    const falhas: string[] = [];
    let chamadas = 0;
    const real = new FsArtifactFileStore();
    const quebradica: ArtifactFileStore = {
      async write(local, agente, arquivo, conteudo) {
        chamadas += 1;
        if (chamadas === 1) throw new Error('disco cheio');
        return real.write(local, agente, arquivo, conteudo);
      },
    };

    const r = await reprojetarArtefatos(db, {
      progresso: () => {},
      reportarFalha: (m) => falhas.push(m),
      arquivos: quebradica,
    });

    expect(r.falhas).toBe(1);
    expect(r.artefatosProjetados).toBe(5);
    expect(falhas).toHaveLength(1);
    expect(falhas[0]).toContain('disco cheio');
  });

  it('argumento desconhecido é recusado', () => {
    expect(() => lerArgumentos(['--nada'])).toThrow(/não reconhecido/);
    expect(lerArgumentos(['--', '--project', 'x'])).toEqual({ projectId: 'x' });
  });
});
