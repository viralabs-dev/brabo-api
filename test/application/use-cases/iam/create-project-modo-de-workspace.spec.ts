import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { CreateProjectUseCase } from '../../../../src/application/use-cases/iam/create-project.use-case';
import { SeedAgentAreasUseCase } from '../../../../src/application/use-cases/agents/seed-agent-areas.use-case';
import { projectScopeRoot } from '../../../../src/infrastructure/filesystem/project-workspaces-root';

/**
 * O CAMINHO até a guarda, e não a guarda sozinha (RN-169/RN-170, ADR 0072).
 *
 * A validação léxica e a de disco já têm teste de unidade em
 * `project-workspaces-root.spec.ts`. O que se prova AQUI é o que a FASE 14d
 * ensinou que testar a peça não prova: que a criação de projeto passa por ela,
 * que a recusa acontece ANTES de o projeto existir, e que o par (modo,
 * caminho) chega coerente ao banco — onde o CHECK é a última barreira.
 */
const { db, pool } = createTestDb();

const projetos = new DrizzleProjectRepository(db);
const criarProjeto = new CreateProjectUseCase(
  new DrizzleUnitOfWork(db),
  projetos,
  new SeedAgentAreasUseCase(new DrizzleAgentAreaRepository(db)),
);

const temporarias: string[] = [];

function pastaDoUsuario(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brabo-projeto-local-'));
  temporarias.push(dir);
  return dir;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterEach(() => {
  for (const dir of temporarias.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

afterAll(async () => {
  await pool.end();
});

async function workspace() {
  const [owner] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-modo', email: 'modo@brabo.dev' })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'modo', slug: 'modo', createdBy: owner.id })
    .returning();
  return { ownerId: owner.id, workspaceId: ws.id };
}

describe('o projeto escolhe onde o código mora (RN-169)', () => {
  it('sem escolha, nasce `container` com caminho nulo — o comportamento de sempre', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'padrao',
      slug: 'padrao',
    });

    expect(projeto.workspaceMode).toBe('container');
    expect(projeto.workspacePath).toBeNull();
    // E a raiz de escopo continua saindo da pasta gerenciada.
    expect(projectScopeRoot(projeto)).toContain(projeto.workspaceDirName);
  });

  it('caminho feliz do modo Local: a raiz de escopo passa a ser a pasta do usuário', async () => {
    const { ownerId, workspaceId } = await workspace();
    const pasta = pastaDoUsuario();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'local',
      slug: 'local',
      workspaceMode: 'local',
      workspacePath: `${pasta}/`,
    });

    expect(projeto.workspaceMode).toBe('local');
    // Gravado NORMALIZADO: validar uma string e gravar outra é como a
    // validação deixa de valer no dia seguinte.
    expect(projeto.workspacePath).toBe(pasta);
    expect(projectScopeRoot(projeto)).toBe(pasta);
    // O nome de pasta continua existindo como identidade — ele só deixou de
    // ser o caminho.
    expect(projeto.workspaceDirName).toBe(`local-${projeto.id.slice(0, 8)}`);
  });
});

describe('a criação RECUSA o caminho que travaria depois (RN-170)', () => {
  it('pasta que não existe dentro do container: 400 com a instrução de montagem, e NENHUM projeto criado', async () => {
    const { ownerId, workspaceId } = await workspace();
    const inexistente = join(pastaDoUsuario(), 'nao-montada');

    const promessa = criarProjeto.execute(workspaceId, ownerId, {
      name: 'quebrado',
      slug: 'quebrado',
      workspaceMode: 'local',
      workspacePath: inexistente,
    });

    await expect(promessa).rejects.toBeInstanceOf(BadRequestException);
    await expect(promessa).rejects.toThrow(/não existe do lado de dentro da api/);
    // A parte que ENSINA — sem ela a recusa seria só um "não".
    await expect(promessa).rejects.toThrow(/docker\/docker-compose\.yml/);

    // O ponto da entrega: o projeto NÃO nasce quebrado para descobrir o
    // problema na primeira ferramenta do primeiro agente.
    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('modo `local` sem caminho é recusado antes de tocar o banco', async () => {
    const { ownerId, workspaceId } = await workspace();

    await expect(
      criarProjeto.execute(workspaceId, ownerId, {
        name: 'sem-caminho',
        slug: 'sem-caminho',
        workspaceMode: 'local',
      }),
    ).rejects.toThrow(/precisa de workspacePath/);

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('caminho junto com `container` é RECUSADO, não ignorado', async () => {
    const { ownerId, workspaceId } = await workspace();

    await expect(
      criarProjeto.execute(workspaceId, ownerId, {
        name: 'confuso',
        slug: 'confuso',
        workspaceMode: 'container',
        workspacePath: pastaDoUsuario(),
      }),
    ).rejects.toThrow(/só vale para projeto no modo "local"/);
  });

  it('a raiz do sistema e o checkout do Brabo são recusados (ADR 0055)', async () => {
    const { ownerId, workspaceId } = await workspace();

    for (const caminho of ['/', '/etc', process.cwd()]) {
      await expect(
        criarProjeto.execute(workspaceId, ownerId, {
          name: 'perigoso',
          slug: 'perigoso',
          workspaceMode: 'local',
          workspacePath: caminho,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });
});
