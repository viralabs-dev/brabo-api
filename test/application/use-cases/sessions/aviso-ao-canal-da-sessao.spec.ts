import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NotFoundException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projects,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { runComoEngine } from '../../../../src/infrastructure/persistence/drizzle/drizzle-context';
import { HttpSessionChannelNotifier } from '../../../../src/infrastructure/http-clients/session-channel-notifier';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

/**
 * AT-157 (RN-579): escrita que a api faz por conta própria também avisa o
 * canal da sessão — só depois do commit, só o tipo e o ator, e nunca a
 * recusada nem a que veio do engine.
 */

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const canal = new HttpSessionChannelNotifier();
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  new DrizzleSessionRepository(db),
  new DrizzleSessionEventRepository(db),
  new DrizzleOutboxRepository(db),
  canal,
);

interface Aviso {
  url: string;
  corpo: Record<string, unknown>;
}

let server: Server | undefined;
let avisos: Aviso[] = [];
const ENGINE_URL_ORIGINAL = process.env.ENGINE_URL;

async function subirEngineDeMentira() {
  avisos = [];
  server = createServer((req, res) => {
    let texto = '';
    req.on('data', (c) => (texto += c));
    req.on('end', () => {
      avisos.push({
        url: req.url ?? '',
        corpo: JSON.parse(texto) as Record<string, unknown>,
      });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// O aviso é disparado sem ser aguardado: espera-se ele chegar, ou a janela
// passar quando o que se afirma é que NÃO chega.
async function esperarAvisos(n: number, teto = 1000) {
  const inicio = Date.now();
  while (avisos.length < n && Date.now() - inicio < teto) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function setupSession() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-canal', email: 'canal@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'core',
      slug: 'core',
      createdBy: user.id,
    })
    .returning();
  const [session] = await db
    .insert(sessions)
    .values({ projectId: project.id, createdBy: user.id })
    .returning();
  return { user, project, session };
}

beforeEach(async () => {
  await truncateAll(db);
  await subirEngineDeMentira();
});

afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  if (ENGINE_URL_ORIGINAL === undefined) delete process.env.ENGINE_URL;
  else process.env.ENGINE_URL = ENGINE_URL_ORIGINAL;
});

afterAll(async () => {
  await pool.end();
});

describe('aviso ao canal da sessão (escrita da api)', () => {
  it('caminho feliz: avisa o engine com tipo e ator, sem o payload', async () => {
    const { project, session, user } = await setupSession();

    await appendSessionEvent.execute(project.id, session.id, {
      type: 'proposed_action.approved',
      actor: { kind: 'user', id: user.id },
      payload: { segredo: 'nao-atravessa' },
    });
    await esperarAvisos(1);

    expect(avisos).toHaveLength(1);
    expect(avisos[0].url).toBe(
      `/internal/sessions/${session.id}/event-appended`,
    );
    expect(avisos[0].corpo).toEqual({
      type: 'proposed_action.approved',
      actorId: user.id,
    });
  });

  it('escrita recusada não avisa', async () => {
    const { project, user } = await setupSession();

    await expect(
      appendSessionEvent.execute(
        project.id,
        '00000000-0000-0000-0000-000000000000',
        {
          type: 'message.sent',
          actor: { kind: 'user', id: user.id },
          payload: {},
        },
      ),
    ).rejects.toThrow(NotFoundException);
    await esperarAvisos(1, 200);

    expect(avisos).toHaveLength(0);
  });

  it('transação externa desfeita não avisa; confirmada avisa uma vez, depois do commit', async () => {
    const { project, session, user } = await setupSession();
    const escrever = () =>
      appendSessionEvent.execute(project.id, session.id, {
        type: 'message.sent',
        actor: { kind: 'user', id: user.id },
        payload: {},
      });

    await expect(
      unitOfWork.runInTransaction(async () => {
        await escrever();
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');
    await esperarAvisos(1, 200);
    expect(avisos).toHaveLength(0);

    await unitOfWork.runInTransaction(async () => {
      await escrever();
      // dentro da transação ainda não saiu nada
      await esperarAvisos(1, 100);
      expect(avisos).toHaveLength(0);
    });
    await esperarAvisos(1);
    expect(avisos).toHaveLength(1);
  });

  it('escrita vinda do engine (/internal) não é avisada de novo pela api', async () => {
    const { project, session, user } = await setupSession();

    await runComoEngine(() =>
      appendSessionEvent.execute(project.id, session.id, {
        type: 'tool.result',
        actor: { kind: 'agent', id: user.id },
        payload: {},
      }),
    );
    await esperarAvisos(1, 200);

    expect(avisos).toHaveLength(0);
  });

  it('engine fora do ar: a escrita segue confirmada e nada estoura', async () => {
    const { project, session, user } = await setupSession();
    process.env.ENGINE_URL = 'http://127.0.0.1:1';

    const evento = await appendSessionEvent.execute(project.id, session.id, {
      type: 'message.sent',
      actor: { kind: 'user', id: user.id },
      payload: {},
    });

    expect(evento.seq).toBe(1);
  });
});
