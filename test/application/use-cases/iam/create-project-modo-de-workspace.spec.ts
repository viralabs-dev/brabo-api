import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
const baseOriginal = process.env.BRABO_PROJECTS_BASE;

/**
 * A BASE da instalação (ADR 0141, RN-500) — desde a RN-501 todo projeto
 * `mounted` precisa morar dentro dela, e a criação recusa o que está fora.
 * Cada teste que cria `mounted` configura a sua.
 */
function baseDaInstalacao(): string {
  const dir = mkdtempSync(join(tmpdir(), 'brabo-base-'));
  temporarias.push(dir);
  process.env.BRABO_PROJECTS_BASE = dir;
  return dir;
}

/** Uma pasta que EXISTE no disco, dentro da base. */
function pastaDoUsuario(): string {
  const dir = mkdtempSync(join(baseDaInstalacao(), 'projeto-'));
  return dir;
}

beforeEach(async () => {
  await truncateAll(db);
});

afterEach(() => {
  if (baseOriginal === undefined) delete process.env.BRABO_PROJECTS_BASE;
  else process.env.BRABO_PROJECTS_BASE = baseOriginal;
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

describe('o projeto escolhe onde o código mora (RN-169/RN-421, ADR 0104)', () => {
  it('sem escolha, nasce `container` com caminho nulo — o comportamento de sempre', async () => {
    const { ownerId, workspaceId } = await workspace();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'padrao',
      slug: 'padrao',
    });

    expect(projeto.executionMode).toBe('container');
    expect(projeto.workspacePath).toBeNull();
    expect(projeto.workspaceVerifiedAt).toBeNull();
    // E a raiz de escopo continua saindo da pasta gerenciada.
    expect(projectScopeRoot(projeto)).toContain(projeto.workspaceDirName);
  });

  it('caminho feliz do modo Pasta montada: a raiz de escopo passa a ser a pasta do usuário', async () => {
    const { ownerId, workspaceId } = await workspace();
    const pasta = pastaDoUsuario();

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'montado',
      slug: 'montado',
      executionMode: 'mounted',
      workspacePath: `${pasta}/`,
    });

    expect(projeto.executionMode).toBe('mounted');
    // Gravado NORMALIZADO: validar uma string e gravar outra é como a
    // validação deixa de valer no dia seguinte.
    expect(projeto.workspacePath).toBe(pasta);
    expect(projeto.workspaceVerifiedAt).toBeNull();
    expect(projectScopeRoot(projeto)).toBe(pasta);
    // O nome de pasta continua existindo como identidade — ele só deixou de
    // ser o caminho.
    expect(projeto.workspaceDirName).toBe(`montado-${projeto.id.slice(0, 8)}`);
  });

  it('caminho feliz do modo Runner: valida só o LÉXICO — a pasta não precisa existir no container (RN-423)', async () => {
    const { ownerId, workspaceId } = await workspace();
    // Nunca criada no disco do processo de teste — é o ponto do caso: só o
    // runner, rodando no host de verdade, confirma que ela existe.
    const inexistenteAqui = '/home/voce/projetos/loja-nunca-montada/';

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'runner',
      slug: 'runner',
      executionMode: 'runner',
      workspacePath: inexistenteAqui,
    });

    expect(projeto.executionMode).toBe('runner');
    expect(projeto.workspacePath).toBe('/home/voce/projetos/loja-nunca-montada');
    // Nasce NÃO verificado — só a confirmação do runner preenche isto.
    expect(projeto.workspaceVerifiedAt).toBeNull();
    expect(projectScopeRoot(projeto)).toBe('/home/voce/projetos/loja-nunca-montada');
  });
});

/**
 * A INVERSÃO do ADR 0142 (RN-501): `mounted` valida só o LÉXICO + a base na
 * criação, e a pasta é MATERIALIZADA depois, quando a Infra sobe o container.
 *
 * O requisito que força isso é do dono do produto — *"se for Pasta montada, o
 * bind-mount deve ser criado APÓS a decisão do Arquiteto"* —, e a validação de
 * disco na criação o tornava impossível: ela recusava muito antes de existir
 * decisão nenhuma.
 */
describe('mounted valida só o léxico + a base na criação (RN-501, ADR 0142)', () => {
  it('pasta INEXISTENTE agora PASSA, e o projeto nasce com workspaceVerifiedAt nulo', async () => {
    const { ownerId, workspaceId } = await workspace();
    const base = baseDaInstalacao();
    const aindaNaoCriada = join(base, 'loja');

    const projeto = await criarProjeto.execute(workspaceId, ownerId, {
      name: 'loja',
      slug: 'loja',
      executionMode: 'mounted',
      workspacePath: aindaNaoCriada,
    });

    expect(projeto.executionMode).toBe('mounted');
    expect(projeto.workspacePath).toBe(aindaNaoCriada);
    // Nasce NÃO verificado: quem carimba é a materialização, junto com o
    // container. Mesmo estado inicial de `runner` (RN-423).
    expect(projeto.workspaceVerifiedAt).toBeNull();
    // E a criação NÃO cria a pasta — é o requisito 3 provado no banco.
    expect(existsSync(aindaNaoCriada)).toBe(false);
  });

  it('fora da base é 400 NOMEANDO a base, e nenhum projeto é criado', async () => {
    const { ownerId, workspaceId } = await workspace();
    const base = baseDaInstalacao();
    const fora = mkdtempSync(join(tmpdir(), 'brabo-fora-'));
    temporarias.push(fora);

    const promessa = criarProjeto.execute(workspaceId, ownerId, {
      name: 'fora',
      slug: 'fora',
      executionMode: 'mounted',
      workspacePath: join(fora, 'loja'),
    });

    await expect(promessa).rejects.toBeInstanceOf(BadRequestException);
    await expect(promessa).rejects.toThrow(
      new RegExp(`precisa ficar dentro de ${base}`),
    );
    // A parte que ENSINA: o caminho sugerido dentro da base.
    await expect(promessa).rejects.toThrow(
      new RegExp(`Sugerido: ${base}/loja`),
    );

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('base NÃO configurada é 400 dizendo que o MODO não está disponível nesta instalação', async () => {
    const { ownerId, workspaceId } = await workspace();
    delete process.env.BRABO_PROJECTS_BASE;

    const promessa = criarProjeto.execute(workspaceId, ownerId, {
      name: 'sem-base',
      slug: 'sem-base',
      executionMode: 'mounted',
      workspacePath: '/home/voce/brabo/loja',
    });

    await expect(promessa).rejects.toBeInstanceOf(BadRequestException);
    await expect(promessa).rejects.toThrow(
      /não está disponível nesta instalação/,
    );
    await expect(promessa).rejects.toThrow(/BRABO_PROJECTS_BASE/);

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });
});

describe('a criação RECUSA o caminho que travaria depois (RN-170/RN-422)', () => {
  it('modo `mounted` sem caminho é recusado antes de tocar o banco', async () => {
    const { ownerId, workspaceId } = await workspace();

    await expect(
      criarProjeto.execute(workspaceId, ownerId, {
        name: 'sem-caminho',
        slug: 'sem-caminho',
        executionMode: 'mounted',
      }),
    ).rejects.toThrow(/precisa de workspacePath/);

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('modo `runner` sem caminho é recusado antes de tocar o banco — mesma régua de mounted', async () => {
    const { ownerId, workspaceId } = await workspace();

    await expect(
      criarProjeto.execute(workspaceId, ownerId, {
        name: 'sem-caminho-runner',
        slug: 'sem-caminho-runner',
        executionMode: 'runner',
      }),
    ).rejects.toThrow(/precisa de workspacePath/);

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('runner: raiz do sistema e checkout do Brabo são recusados léxico — sem tocar disco (ADR 0055/RN-423)', async () => {
    const { ownerId, workspaceId } = await workspace();

    for (const caminho of ['/', '/etc', process.cwd()]) {
      await expect(
        criarProjeto.execute(workspaceId, ownerId, {
          name: 'perigoso-runner',
          slug: 'perigoso-runner',
          executionMode: 'runner',
          workspacePath: caminho,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });

  it('caminho junto com `container` é RECUSADO, não ignorado', async () => {
    const { ownerId, workspaceId } = await workspace();

    await expect(
      criarProjeto.execute(workspaceId, ownerId, {
        name: 'confuso',
        slug: 'confuso',
        executionMode: 'container',
        workspacePath: pastaDoUsuario(),
      }),
    ).rejects.toThrow(/só vale para projeto nos modos "mounted"\/"runner"/);
  });

  it('a raiz do sistema e o checkout do Brabo são recusados (ADR 0055)', async () => {
    const { ownerId, workspaceId } = await workspace();

    for (const caminho of ['/', '/etc', process.cwd()]) {
      await expect(
        criarProjeto.execute(workspaceId, ownerId, {
          name: 'perigoso',
          slug: 'perigoso',
          executionMode: 'mounted',
          workspacePath: caminho,
        }),
      ).rejects.toThrow(BadRequestException);
    }

    expect(await projetos.listForWorkspace(workspaceId)).toEqual([]);
  });
});
