import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { eq } from 'drizzle-orm';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, sessions, users, workspaces } from '../../../../src/db/schema';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleSessionRepository } from '../../../../src/infrastructure/persistence/drizzle/session.repository';
import { DrizzleSessionEventRepository } from '../../../../src/infrastructure/persistence/drizzle/session-event.repository';
import { DrizzleOutboxRepository } from '../../../../src/infrastructure/persistence/drizzle/outbox.repository';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import { CreateSessionUseCase } from '../../../../src/application/use-cases/sessions/create-session.use-case';
import { RenameSessionUseCase } from '../../../../src/application/use-cases/sessions/rename-session.use-case';
import { CreateSessionDto } from '../../../../src/interfaces/http/sessions/dto/create-session.dto';
import { RenameSessionDto } from '../../../../src/interfaces/http/sessions/dto/rename-session.dto';
import {
  EVENTO_DE_EXECUCAO,
  SESSION_KIND_PADRAO,
  SessionKindNaoExecutaError,
  garantirQuePodeAtivarExecucao,
  podeAtivarExecucao,
} from '../../../../src/domain/sessions/session-kind';

/**
 * FASE 20 — o tipo da sessão é dado da criação, e a execução continua evento.
 *
 * As duas fontes de verdade que passam a coexistir são o risco real desta
 * fase, e é sobre a fronteira entre elas que os testes mais duros aqui falam:
 *
 * - `kind` classifica a INTENÇÃO de criação (RN-097) e não muda;
 * - `execution.activated` continua classificando ESTADO de execução;
 * - o evento numa sessão `consultiva` é ERRO, nunca conversão silenciosa.
 *
 * O teste de mutação que acompanha esta fase é justamente esse: fazer o append
 * aceitar o evento numa sessão consultiva mata o caso "recusa" abaixo.
 */

const { db, pool } = createTestDb();
const unitOfWork = new DrizzleUnitOfWork(db);
const sessionRepo = new DrizzleSessionRepository(db);
const sessionEventRepo = new DrizzleSessionEventRepository(db);
const outboxRepo = new DrizzleOutboxRepository(db);

const createSession = new CreateSessionUseCase(
  unitOfWork,
  sessionRepo,
  outboxRepo,
);
const renameSession = new RenameSessionUseCase(sessionRepo);
const appendSessionEvent = new AppendSessionEventUseCase(
  unitOfWork,
  sessionRepo,
  sessionEventRepo,
  outboxRepo,
);

async function cenario() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-kind', email: 'kind@brabo.dev' })
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
  const [outroProjeto] = await db
    .insert(projects)
    .values({
      workspaceId: workspace.id,
      name: 'outro',
      slug: 'outro',
      createdBy: user.id,
    })
    .returning();
  return { user, project, outroProjeto };
}

function ativarExecucao(projectId: string, sessionId: string, userId: string) {
  return appendSessionEvent.execute(projectId, sessionId, {
    type: EVENTO_DE_EXECUCAO,
    actor: { kind: 'user', id: userId },
    payload: { modules: ['api'] },
  });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

describe('RN-097 — `kind` é intenção de criação; o evento é estado de execução', () => {
  it('caminho feliz: a sessão nasce com o tipo escolhido e o nome dado', async () => {
    const { project, user } = await cenario();

    const session = await createSession.execute(project.id, user.id, {
      kind: 'criativa',
      name: 'Checkout do carrinho',
    });

    expect(session.kind).toBe('criativa');
    expect(session.name).toBe('Checkout do carrinho');

    // E ficou GRAVADO, que é a decisão do usuário nesta fase: o tipo não é
    // derivado de nada nem recalculado na leitura.
    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.kind).toBe('criativa');
  });

  it('sessão criativa aceita `execution.activated`', async () => {
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'criativa',
    });

    const evento = await ativarExecucao(project.id, session.id, user.id);
    expect(evento.type).toBe(EVENTO_DE_EXECUCAO);
  });

  it('CASO DE FALHA: `execution.activated` em sessão consultiva é recusado', async () => {
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
    });

    await expect(
      ativarExecucao(project.id, session.id, user.id),
    ).rejects.toThrow(ConflictException);
  });

  it('a recusa não deixa rastro: nem evento, nem seq consumido', async () => {
    // O ponto é a ORDEM da checagem. Feita depois do `incrementSeq`, a sessão
    // ficaria com um buraco no contador a cada tentativa recusada — e `seq`
    // sem gaps é o que sustenta a paginação do log.
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
    });

    await expect(
      ativarExecucao(project.id, session.id, user.id),
    ).rejects.toThrow(ConflictException);

    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.nextSeq).toBe(1);
  });

  it('a sessão consultiva continua aceitando todo o resto do log', async () => {
    // A trava é de UM tipo de evento. Se ela alcançasse os outros, uma sessão
    // consultiva não poderia nem registrar a conversa que é a razão dela.
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
    });

    const evento = await appendSessionEvent.execute(project.id, session.id, {
      type: 'chat.message',
      actor: { kind: 'user', id: user.id },
      payload: { text: 'oi' },
    });
    expect(evento.seq).toBe(1);
  });

  it('o evento continua sendo a fonte do ESTADO de execução — `kind` não basta', async () => {
    // A reconciliação em uma asserção: uma sessão CRIATIVA que nunca ativou
    // execução NÃO é a sessão de execução vigente. Se `findActiveExecutionSession`
    // passasse a olhar `kind`, este teste morre.
    const { project, user } = await cenario();
    const criativa = await createSession.execute(project.id, user.id, {
      kind: 'criativa',
    });
    await db
      .update(sessions)
      .set({ status: 'active' })
      .where(eq(sessions.id, criativa.id));

    expect(await sessionRepo.findActiveExecutionSession(project.id)).toBeNull();

    await ativarExecucao(project.id, criativa.id, user.id);

    const vigente = await sessionRepo.findActiveExecutionSession(project.id);
    expect(vigente?.id).toBe(criativa.id);
  });

  it('o default da coluna é o tipo que pode MENOS', async () => {
    // Caminho que não passa pela rota (migração, SQL de manutenção): a linha
    // nasce consultiva e não ganha o direito de executar de graça.
    const { project, user } = await cenario();
    const [linha] = await db
      .insert(sessions)
      .values({ projectId: project.id, createdBy: user.id })
      .returning();

    expect(linha.kind).toBe(SESSION_KIND_PADRAO);
    expect(podeAtivarExecucao(linha.kind)).toBe(false);
  });

  it('a regra do domínio nomeia o tipo que recusou', () => {
    // Origem da falha declarada, não "não deu certo": a mensagem diz qual tipo
    // barrou e o que fazer.
    expect(() => garantirQuePodeAtivarExecucao('criativa')).not.toThrow();
    try {
      garantirQuePodeAtivarExecucao('consultiva');
      expect.unreachable('devia ter lançado');
    } catch (error) {
      expect(error).toBeInstanceOf(SessionKindNaoExecutaError);
      expect((error as SessionKindNaoExecutaError).kind).toBe('consultiva');
      expect((error as Error).message).toContain('criativa');
    }
  });
});

describe('RN-098 — o nome não substitui a hashtag', () => {
  it('caminho feliz: renomear grava o nome novo', async () => {
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
    });
    expect(session.name).toBeNull();

    const renomeada = await renameSession.execute(
      project.id,
      session.id,
      'Dúvidas de billing',
    );
    expect(renomeada.name).toBe('Dúvidas de billing');
  });

  it('`null` tira o nome — é o caminho de desfazer', async () => {
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
      name: 'Provisório',
    });

    const semNome = await renameSession.execute(project.id, session.id, null);
    expect(semNome.name).toBeNull();
  });

  it('nome em branco conta como ausência, não como nome vazio', async () => {
    // Sem isto o rótulo da tela viraria " · #a1b2c3d4" — pior que a hashtag
    // sozinha, que é exatamente o que a RN-098 quer preservar.
    const { project, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
      name: '   ',
    });
    expect(session.name).toBeNull();

    const renomeada = await renameSession.execute(
      project.id,
      session.id,
      '  Beta  ',
    );
    expect(renomeada.name).toBe('Beta');
  });

  it('CASO DE FALHA: renomear sessão de outro projeto não encontra nem altera', async () => {
    const { project, outroProjeto, user } = await cenario();
    const session = await createSession.execute(project.id, user.id, {
      kind: 'consultiva',
      name: 'Original',
    });

    await expect(
      renameSession.execute(outroProjeto.id, session.id, 'Sequestrada'),
    ).rejects.toThrow(NotFoundException);

    const [linha] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(linha.name).toBe('Original');
  });
});

describe('o corpo das rotas de sessão', () => {
  const erros = (cls: typeof CreateSessionDto, corpo: object) =>
    validateSync(plainToInstance(cls, corpo) as object).flatMap((e) =>
      Object.keys(e.constraints ?? {}).map(() => e.property),
    );

  it('CASO DE FALHA: criar SEM tipo é recusado', () => {
    // O pedido do usuário é que o tipo seja escolhido na criação. Um default
    // no corpo faria a escolha desaparecer de novo — que é o defeito de
    // origem, com outro nome.
    expect(erros(CreateSessionDto, {})).toContain('kind');
    expect(erros(CreateSessionDto, { kind: 'execucao' })).toContain('kind');
  });

  it('criar com tipo válido passa, com e sem nome', () => {
    expect(erros(CreateSessionDto, { kind: 'consultiva' })).toEqual([]);
    expect(
      erros(CreateSessionDto, { kind: 'criativa', name: 'Checkout' }),
    ).toEqual([]);
  });

  it('nome acima do teto é recusado', () => {
    const gigante = 'x'.repeat(81);
    expect(erros(CreateSessionDto, { kind: 'criativa', name: gigante })).toContain(
      'name',
    );
  });

  it('renomear aceita `null`, recusa a ausência do campo', () => {
    const errosRename = (corpo: object) =>
      validateSync(plainToInstance(RenameSessionDto, corpo) as object).map(
        (e) => e.property,
      );

    expect(errosRename({ name: null })).toEqual([]);
    expect(errosRename({ name: 'Checkout' })).toEqual([]);
    // Corpo vazio não é "apagar o nome": é pedido incompleto.
    expect(errosRename({})).toContain('name');
  });
});
