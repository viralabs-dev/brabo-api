import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ulid } from 'ulid';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, sessions, users, workspaces } from '../../../../src/db/schema';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { ListSessionEventsUseCase } from '../../../../src/application/use-cases/sessions/list-session-events.use-case';
import { SessionsController } from '../../../../src/interfaces/http/sessions/sessions.controller';

/**
 * O filtro `actionId` da leitura de eventos da sessão (AT-336, RN-614).
 *
 * A ação (`proposed_actions`) não guarda o motivo da política; ele mora no
 * `proposed_action.created`. A aba Aprovações lê a fila do PROJETO e os
 * eventos de UMA sessão, então o motivo da ação de outra sessão, ou fora da
 * janela, ficava sem fonte. O filtro devolve só os eventos daquela ação,
 * DENTRO da sessão pedida — contra Postgres de verdade, porque o predicado é
 * sobre o JSON do payload.
 */

const { db, pool } = createTestDb();
const eventos = new DrizzleSessionEventRepository(db);
const listar = new ListSessionEventsUseCase(
  new DrizzleSessionRepository(db),
  eventos,
);

async function semear() {
  const [dono] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-acao', email: 'acao@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: dono.id })
    .returning();
  const [projeto] = await db
    .insert(projects)
    .values({ workspaceId: ws.id, name: 'core', slug: 'core', createdBy: dono.id })
    .returning();
  const [outroProjeto] = await db
    .insert(projects)
    .values({ workspaceId: ws.id, name: 'web', slug: 'web', createdBy: dono.id })
    .returning();
  const [sessao] = await db
    .insert(sessions)
    .values({ projectId: projeto.id, createdBy: dono.id })
    .returning();
  const [outraSessao] = await db
    .insert(sessions)
    .values({ projectId: projeto.id, createdBy: dono.id })
    .returning();
  return { projeto, outroProjeto, sessao, outraSessao };
}

let seq = 0;
async function anexar(sessionId: string, type: string, payload: unknown) {
  seq += 1;
  return eventos.append({
    id: ulid(),
    sessionId,
    seq,
    type,
    actor: { kind: 'agent', id: 'dev-core' },
    payload,
  });
}

beforeEach(async () => {
  seq = 0;
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('ListSessionEventsUseCase — filtro por `actionId`', () => {
  it('caminho feliz: devolve só os eventos da ação pedida, com o motivo da política', async () => {
    const { projeto, sessao } = await semear();
    await anexar(sessao.id, 'chat.message', { text: 'oi' });
    await anexar(sessao.id, 'proposed_action.created', {
      actionId: 'acao-a',
      actionType: 'terminal',
      status: 'pending',
      reason: 'fora do allowlist',
    });
    await anexar(sessao.id, 'proposed_action.created', {
      actionId: 'acao-b',
      actionType: 'git_commit',
      status: 'pending',
      reason: 'regra específica',
    });
    await anexar(sessao.id, 'proposed_action.approved', { actionId: 'acao-a' });

    const pagina = await listar.execute(projeto.id, sessao.id, {
      actionId: 'acao-a',
      limit: 200,
    });

    expect(pagina.items.map((e) => e.type)).toEqual([
      'proposed_action.created',
      'proposed_action.approved',
    ]);
    expect(pagina.items[0].payload).toMatchObject({ reason: 'fora do allowlist' });
  });

  it('não atravessa sessões: a mesma ação noutra sessão do projeto não vem', async () => {
    const { projeto, sessao, outraSessao } = await semear();
    await anexar(outraSessao.id, 'proposed_action.created', {
      actionId: 'acao-a',
      reason: 'x',
    });

    const pagina = await listar.execute(projeto.id, sessao.id, {
      actionId: 'acao-a',
    });

    expect(pagina.items).toEqual([]);
  });

  it('recusa: sessão de OUTRO projeto é 404, mesmo com o filtro', async () => {
    const { outroProjeto, sessao } = await semear();
    await anexar(sessao.id, 'proposed_action.created', { actionId: 'acao-a' });

    await expect(
      listar.execute(outroProjeto.id, sessao.id, { actionId: 'acao-a' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('GET .../sessions/:sessionId/events?actionId=', () => {
  it('recusa: `actionId` vazio é 400, nunca "sem filtro"', () => {
    const controller = new SessionsController(
      ...(Array.from({ length: SessionsController.length }, () => ({
        execute: () => {
          throw new Error('não deveria chegar ao caso de uso');
        },
      })) as ConstructorParameters<typeof SessionsController>),
    );

    expect(() =>
      controller.listEvents('p', 's', undefined, undefined, undefined, '  '),
    ).toThrow(BadRequestException);
  });
});
