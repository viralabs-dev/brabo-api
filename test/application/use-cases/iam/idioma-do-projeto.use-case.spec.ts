import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleProjectRepository } from '../../../../src/infrastructure/persistence/drizzle/project.repository';
import { DrizzleAgentAreaRepository } from '../../../../src/infrastructure/persistence/drizzle/agent-area.repository';
import { DrizzleUnitOfWork } from '../../../../src/infrastructure/persistence/drizzle/drizzle-unit-of-work';
import { DrizzleUserRepository } from '../../../../src/infrastructure/persistence/drizzle/user.repository';
import { DrizzleSessionLanguageOverrideRepository } from '../../../../src/infrastructure/persistence/drizzle/session-language-override.repository';
import { CreateProjectUseCase } from '../../../../src/application/use-cases/iam/create-project.use-case';
import { UpdateProjectUseCase } from '../../../../src/application/use-cases/iam/update-project.use-case';
import { SeedAgentAreasUseCase } from '../../../../src/application/use-cases/agents/seed-agent-areas.use-case';
import { ResolverIdiomaDaRespostaUseCase } from '../../../../src/application/use-cases/iam/resolver-idioma-da-resposta.use-case';

/**
 * O idioma do PROJETO (RN-619, ADR 0177), pelo caminho de verdade: o caso de
 * uso que a rota de criação chama, contra o banco.
 */
const { db, pool } = createTestDb();

const projetos = new DrizzleProjectRepository(db);
const criarProjeto = new CreateProjectUseCase(
  new DrizzleUnitOfWork(db),
  projetos,
  new SeedAgentAreasUseCase(new DrizzleAgentAreaRepository(db)),
  new ResolverIdiomaDaRespostaUseCase(
    new DrizzleUserRepository(db),
    new DrizzleSessionLanguageOverrideRepository(db),
  ),
);
const atualizarProjeto = new UpdateProjectUseCase(projetos);

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function workspaceDe(
  usuario: Partial<typeof users.$inferInsert> = {},
): Promise<{ ownerId: string; workspaceId: string }> {
  const [owner] = await db
    .insert(users)
    .values({
      keycloakSub: 'sub-idioma',
      email: 'idioma@brabo.dev',
      ...usuario,
    })
    .returning();
  const [ws] = await db
    .insert(workspaces)
    .values({ name: 'idioma', slug: 'idioma', createdBy: owner.id })
    .returning();
  return { ownerId: owner.id, workspaceId: ws.id };
}

describe('o idioma do projeto na criação (RN-619)', () => {
  it('sem pedido, nasce com o idioma da interface de quem cria quando nada foi escolhido', async () => {
    const { ownerId, workspaceId } = await workspaceDe({ locale: 'en' });

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Loja',
      slug: 'loja',
    });

    expect(projeto.language).toBe('en');
  });

  it('sem pedido, a ESCOLHA da conta de quem cria vence a interface', async () => {
    const { ownerId, workspaceId } = await workspaceDe({
      locale: 'pt-BR',
      responseLanguage: 'es',
    });

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Loja',
      slug: 'loja',
    });

    expect(projeto.language).toBe('es');
  });

  it('com pedido, grava a forma canônica', async () => {
    const { ownerId, workspaceId } = await workspaceDe();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Loja',
      slug: 'loja',
      language: 'fr-ca',
    });

    expect(projeto.language).toBe('fr-CA');
  });

  it('código inválido é 400 e o projeto NÃO nasce — nem "automatico", que o projeto não tem', async () => {
    const { ownerId, workspaceId } = await workspaceDe();

    for (const invalido of ['zz', 'automatico']) {
      await expect(
        criarProjeto.execute(workspaceId, ownerId, {
          name: 'Loja',
          slug: 'loja',
          language: invalido,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(await db.select().from(projects)).toHaveLength(0);
  });
});

describe('o idioma do projeto na edição (RN-619)', () => {
  it('PATCH grava canônico e não toca o resto', async () => {
    const { ownerId, workspaceId } = await workspaceDe();
    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Loja',
      slug: 'loja',
    });

    const editado = await atualizarProjeto.execute(projeto.id, {
      language: 'de',
    });

    expect(editado.language).toBe('de');
    expect(editado.name).toBe('Loja');
  });

  it('PATCH com código inválido é 400 e o idioma fica como estava', async () => {
    const { ownerId, workspaceId } = await workspaceDe();
    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'Loja',
      slug: 'loja',
    });

    await expect(
      atualizarProjeto.execute(projeto.id, { name: 'Outro', language: 'x-y' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const [linha] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projeto.id));
    expect(linha.language).toBe('pt-BR');
    expect(linha.name).toBe('Loja');
  });
});

describe('a migração dos projetos que já existiam (RN-619)', () => {
  it('grava o idioma do TITULAR do workspace, pela cadeia da conta', async () => {
    // O UPDATE da migração, rodado de novo contra linhas que o simulam: a
    // coluna já existe (o template do banco de teste migrou), então o que se
    // prova é o SQL do backfill, lido do próprio arquivo da migração.
    const titular = await workspaceDe({ locale: 'en', responseLanguage: 'it' });
    const [outro] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-outro', email: 'outro@brabo.dev' })
      .returning();
    await db.insert(projects).values({
      workspaceId: titular.workspaceId,
      name: 'Antigo',
      slug: 'antigo',
      workspaceDirName: 'antigo-legado',
      createdBy: outro.id,
    });

    const migracao = readFileSync(
      join(
        __dirname,
        '../../../../src/db/migrations/0062_idioma_do_projeto.sql',
      ),
      'utf8',
    );
    const backfill = migracao.slice(migracao.indexOf('UPDATE "projects"'));
    await db.execute(sql.raw(backfill));

    const [linha] = await db.select().from(projects);
    // `it`, a ESCOLHA do titular — não o `pt-BR` de quem criou o projeto.
    expect(linha.language).toBe('it');
  });
});
