import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { CreateProjectUseCase } from '../../../../src/application/use-cases/iam/create-project.use-case';
import { SeedAgentAreasUseCase } from '../../../../src/application/use-cases/agents/seed-agent-areas.use-case';
import { ListAgentAreasUseCase } from '../../../../src/application/use-cases/execution/list-agent-areas.use-case';
import { AGENT_AREAS } from '../../../../src/domain/agents/agent-areas';
import type { AgentAreaRepository } from '../../../../src/application/ports/agent-area-repository.port';

/**
 * O teste do CAMINHO, não da peça (FASE 18, RN-094).
 *
 * `AgentAreaRepository.upsert` tinha teste e não tinha chamador: a tabela
 * `agent_areas` ficava vazia em produção, `GET /projects/:id/agent-areas`
 * devolvia `[]` e o teto de paralelismo lia o nada. É a mesma falha da FASE
 * 14d, e é por isso que este teste entra pela porta de cima — o caso de uso
 * que a rota de criação de projeto chama — com os repositórios REAIS contra o
 * banco. Um fake do repositório aqui não provaria nada: era exatamente o que
 * já existia.
 */
const { db, pool } = createTestDb();

const projetos = new DrizzleProjectRepository(db);
const areas = new DrizzleAgentAreaRepository(db);
const listarAreas = new ListAgentAreasUseCase(areas);
const criarProjeto = new CreateProjectUseCase(
  new DrizzleUnitOfWork(db),
  projetos,
  new SeedAgentAreasUseCase(areas),
);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function workspace() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-areas', email: 'areas@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'areas', slug: 'areas', createdBy: owner.id })
    .returning();
  return { ownerId: owner.id, workspaceId: ws.id };
}

describe('projeto recém-criado TEM áreas (RN-094)', () => {
  it('as três áreas canônicas nascem com o projeto, sem ativar execução nenhuma', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'novo',
      slug: 'novo',
    });

    const gravadas = await listarAreas.execute(projeto.id);

    // Comparado contra a lista CANÔNICA, não contra três chaves escritas à
    // mão: área nova lá dentro passa a cobrar seeding aqui.
    expect(gravadas.map((a) => a.key).sort()).toEqual(
      AGENT_AREAS.map((a) => a.key).sort(),
    );
    expect(
      Object.fromEntries(gravadas.map((a) => [a.key, a.leadAgentId])),
    ).toEqual(Object.fromEntries(AGENT_AREAS.map((a) => [a.key, a.lead])));
  });

  it('os membros enumeráveis vêm junto; a área DINÂMICA de dev nasce vazia', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'membros',
      slug: 'membros',
    });

    const porChave = new Map(
      (await listarAreas.execute(projeto.id)).map((a) => [a.key, a]),
    );

    expect(porChave.get('qa')?.members.sort()).toEqual([
      'qa-automacao',
      'qa-performance-seguranca',
    ]);
    expect(porChave.get('infra')?.members).toEqual(['infra-workflows']);
    // Os membros de dev são um por módulo do `module_map`, que não existe na
    // criação. Quem sustenta a REGRA de endereçamento enquanto isso é o
    // predicado `ehDevDeModulo`, que não consulta o banco.
    expect(porChave.get('dev')?.members).toEqual([]);
  });

  it('o teto de cada área nasce no default da coluna — a criação não decide gasto', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'teto',
      slug: 'teto',
    });

    const gravadas = await listarAreas.execute(projeto.id);

    // O `toHaveLength` não é decoração: `every` sobre lista VAZIA é `true`, e
    // sem ele este teste sobreviveria a remover o seeding inteiro.
    expect(gravadas).toHaveLength(AGENT_AREAS.length);
    expect(gravadas.every((a) => a.maxParallel === 2)).toBe(true);
  });

  it('seeding que falha derruba a criação inteira — projeto quebrado não nasce', async () => {
    // O caso de falha. Sem a transação, o projeto ficaria gravado e sem área:
    // o estado exato que a FASE 18 foi corrigir, e que ninguém veria até a
    // tela de Configurações abrir vazia.
    const { ownerId, workspaceId } = await workspace();

    const quebrado = new CreateProjectUseCase(
      new DrizzleUnitOfWork(db),
      projetos,
      new SeedAgentAreasUseCase({
        upsert: () => Promise.reject(new Error('sem conexão')),
      } as unknown as AgentAreaRepository),
    );

    await expect(
      quebrado.execute(workspaceId, ownerId, { name: 'x', slug: 'x' }),
    ).rejects.toThrow('sem conexão');

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });
});

describe('nome de pasta legível (RN-109)', () => {
  it('workspaceDirName nasce <slug>-<8 chars do id>', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Pasta Legível',
      slug: 'pasta-legivel',
    });

    expect(projeto.workspaceDirName).toBe(
      `pasta-legivel-${projeto.id.slice(0, 8)}`,
    );
  });

  it('dois projetos com o MESMO slug em workspaces diferentes não colidem de pasta', async () => {
    const a = await workspace();
    const [outroOwner] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-areas-2', email: 'areas2@brabo.dev' })
      .returning();
    const [outroWs] = await db
      .insert(workspaces)
      .values({ name: 'areas2', slug: 'areas2', createdBy: outroOwner.id })
      .returning();

    const p1 = await criarProjeto.execute(a.workspaceId, a.ownerId, {
      name: 'api',
      slug: 'api',
    });
    const p2 = await criarProjeto.execute(outroWs.id, outroOwner.id, {
      name: 'api',
      slug: 'api',
    });

    expect(p1.workspaceDirName).not.toBe(p2.workspaceDirName);
  });
});
