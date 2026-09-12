import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import { projects, users, workspaces } from '../../../../src/db/schema';
import { DrizzleRunnerDeviceKeyRepository } from '../../../../src/infrastructure/persistence/drizzle/runner-device-key.repository';

/**
 * As DUAS espécies de chave de dispositivo numa tabela só (RN-543, ADR 0154
 * ponto 1) — provado contra o Postgres de verdade, porque o que muda é uma
 * coluna que deixou de ser `NOT NULL` e um `WHERE` que passou a aceitar
 * `IS NULL`. Fake nenhum prova nenhum dos dois.
 *
 * O que estes casos protegem:
 *
 * - uma chave de MÁQUINA existe (a migração soltou o `NOT NULL`);
 * - ela aparece na listagem de QUALQUER projeto do dono, MARCADA — sem isso
 *   ela seria invisível em toda tela, que é o defeito que a RN-519 fechou;
 * - a chave de OUTRO projeto continua NÃO aparecendo — a listagem não virou
 *   um "tudo do usuário".
 */
const { db, pool } = createTestDb();
const repo = new DrizzleRunnerDeviceKeyRepository(db);

const JWK = JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: 'abc' });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await pool.end();
});

async function cenario() {
  const [user] = await db
    .insert(users)
    .values({ keycloakSub: 'sub-device-keys', email: 'device@brabo.dev' })
    .returning();
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'acme', slug: 'acme', createdBy: user.id })
    .returning();
  const criarProjeto = async (slug: string) => {
    const [projeto] = await db
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: slug,
        slug,
        workspaceDirName: `${slug}-dir`,
        createdBy: user.id,
      })
      .returning();
    return projeto;
  };
  return {
    user,
    projetoA: await criarProjeto('a'),
    projetoB: await criarProjeto('b'),
  };
}

describe('DrizzleRunnerDeviceKeyRepository — chave de máquina (RN-543)', () => {
  it('caminho feliz: registra com `projectId: null` e a espécie sai como `maquina`', async () => {
    const { user } = await cenario();

    const chave = await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'desktop',
      publicKeyJwk: JWK,
    });

    expect(chave.projectId).toBeNull();
    expect(chave.especie).toBe('maquina');
  });

  it('a espécie é DERIVADA do projeto, num lugar só: com projeto, é `projeto`', async () => {
    const { user, projetoA } = await cenario();

    const chave = await repo.registrar({
      userId: user.id,
      projectId: projetoA.id,
      name: 'laptop',
      publicKeyJwk: JWK,
    });

    expect(chave.especie).toBe('projeto');
  });

  it('a listagem de um projeto traz as DELE e as de MÁQUINA — nunca a de outro projeto', async () => {
    const { user, projetoA, projetoB } = await cenario();
    await repo.registrar({
      userId: user.id,
      projectId: projetoA.id,
      name: 'do-projeto-a',
      publicKeyJwk: JWK,
    });
    await repo.registrar({
      userId: user.id,
      projectId: projetoB.id,
      name: 'do-projeto-b',
      publicKeyJwk: JWK,
    });
    await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    const listadas = await repo.listarDoUsuarioNoProjeto(user.id, projetoA.id);

    expect(listadas.map((c) => c.name).sort()).toEqual([
      'da-maquina',
      'do-projeto-a',
    ]);
    expect(listadas.find((c) => c.name === 'da-maquina')?.especie).toBe(
      'maquina',
    );
  });

  it('a mesma chave de máquina aparece na listagem dos DOIS projetos, com o mesmo id', async () => {
    const { user, projetoA, projetoB } = await cenario();
    const registrada = await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    const [emA] = await repo.listarDoUsuarioNoProjeto(user.id, projetoA.id);
    const [emB] = await repo.listarDoUsuarioNoProjeto(user.id, projetoB.id);

    expect(emA.id).toBe(registrada.id);
    expect(emB.id).toBe(registrada.id);
  });

  it('CASO DE FALHA: chave de máquina de OUTRO usuário nunca entra na listagem', async () => {
    const { user, projetoA } = await cenario();
    const [outro] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-outro', email: 'outro@brabo.dev' })
      .returning();
    await repo.registrar({
      userId: outro.id,
      projectId: null,
      name: 'da-maquina-alheia',
      publicKeyJwk: JWK,
    });

    expect(await repo.listarDoUsuarioNoProjeto(user.id, projetoA.id)).toEqual(
      [],
    );
  });

  it('`buscarChavePublicaAtiva` devolve `projectId: null` — é por ele que o guard sabe a espécie', async () => {
    const { user } = await cenario();
    const registrada = await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    const ativa = await repo.buscarChavePublicaAtiva(registrada.id);

    expect(ativa).toMatchObject({ userId: user.id, projectId: null });
  });

  it('revogar a de máquina funciona pelo par `{id, usuário}`, sem projeto nenhum', async () => {
    const { user } = await cenario();
    const registrada = await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    const revogada = await repo.revogar(registrada.id, user.id, 'teste');

    expect(revogada?.revokedAt).toBeInstanceOf(Date);
    expect(await repo.buscarChavePublicaAtiva(registrada.id)).toBeNull();
  });
});

/**
 * A substituição que impede a rota do instalador de virar fábrica de chaves
 * (RN-552). Provado contra o Postgres de verdade pelo mesmo motivo dos casos
 * acima: o que decide é um `WHERE` com dois `IS NULL` — um diz "de máquina",
 * o outro diz "ainda viva" —, e fake nenhum prova um `WHERE`.
 */
describe('DrizzleRunnerDeviceKeyRepository — substituir a chave de máquina (RN-552)', () => {
  it('caminho feliz: revoga as de MÁQUINA ativas e devolve os ids do que caiu', async () => {
    const { user } = await cenario();
    const primeira = await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    const caidas = await repo.revogarChavesDeMaquina(user.id, 'reinstalação');

    expect(caidas).toEqual([primeira.id]);
    expect(await repo.buscarChavePublicaAtiva(primeira.id)).toBeNull();
  });

  it('CASO DE FALHA: NÃO derruba a chave de PROJETO nem a de máquina de outro usuário', async () => {
    const { user, projetoA } = await cenario();
    const doProjeto = await repo.registrar({
      userId: user.id,
      projectId: projetoA.id,
      name: 'do-navegador',
      publicKeyJwk: JWK,
    });
    const [outro] = await db
      .insert(users)
      .values({ keycloakSub: 'sub-outro-maquina', email: 'outro2@brabo.dev' })
      .returning();
    const alheia = await repo.registrar({
      userId: outro.id,
      projectId: null,
      name: 'da-maquina-alheia',
      publicKeyJwk: JWK,
    });

    expect(await repo.revogarChavesDeMaquina(user.id, 'reinstalação')).toEqual(
      [],
    );
    expect(await repo.buscarChavePublicaAtiva(doProjeto.id)).not.toBeNull();
    expect(await repo.buscarChavePublicaAtiva(alheia.id)).not.toBeNull();
  });

  it('idempotente: chamar de novo não revoga o que já estava revogado', async () => {
    const { user } = await cenario();
    await repo.registrar({
      userId: user.id,
      projectId: null,
      name: 'da-maquina',
      publicKeyJwk: JWK,
    });

    await repo.revogarChavesDeMaquina(user.id, 'primeira');
    expect(await repo.revogarChavesDeMaquina(user.id, 'segunda')).toEqual([]);
  });
});
