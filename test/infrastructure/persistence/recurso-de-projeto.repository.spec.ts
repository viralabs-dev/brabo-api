import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../support/test-db';
import { DrizzleRecursoDeProjetoRepository } from '../../../src/infrastructure/persistence/drizzle/recurso-de-projeto.repository';

import { DrizzleContainersOverviewRepository } from '../../../src/infrastructure/persistence/drizzle/containers-overview.repository';

/** `project_resources` (AT-980, RN-1382): sem FK, então o projeto não precisa existir. */
const { db, pool } = createTestDb();
const repo = new DrizzleRecursoDeProjetoRepository(db);
const P = '11111111-1111-4111-8111-111111111111';

beforeEach(async () => {
  await truncateAll(db);
});
afterAll(async () => {
  await pool.end();
});

describe('DrizzleRecursoDeProjetoRepository', () => {
  it('upsert por (projeto, tipo, chave): pedido -> falhou com motivo -> criado limpa o motivo', async () => {
    await repo.gravar(P, 'container', '', { estado: 'pedido' });
    await repo.gravar(P, 'container', '', { estado: 'falhou', motivo: 'bind' });
    const falhou = await repo.listar(['falhou']);
    expect(falhou).toHaveLength(1);
    let [l] = falhou;
    expect(l).toMatchObject({ estado: 'falhou', motivo: 'bind' });
    await repo.gravar(P, 'container', '', {
      estado: 'criado',
      containerId: 'c1',
    });
    [l] = await repo.listar(['criado']);
    expect(l).toMatchObject({ motivo: null, containerId: 'c1' });
  });

  it('marcarRemovendoDoProjeto pega tudo menos o removido; concluir fecha ou conta tentativa', async () => {
    await repo.gravar(P, 'container', '', { estado: 'criado' });
    await repo.gravar(P, 'container_qa', 'a1b2c3d4', { estado: 'falhou' });
    await repo.gravar(P, 'container_qa', 'e5f6a7b8', { estado: 'removido' });
    expect(await repo.marcarRemovendoDoProjeto(P)).toBe(2);

    await repo.concluirRemocaoDoProjeto(P, 'broker fora');
    const pendentes = await repo.listar(['removendo']);
    expect(pendentes).toHaveLength(2);
    expect(
      pendentes.every((r) => r.tentativas === 1 && r.motivo === 'broker fora'),
    ).toBe(true);

    await repo.concluirRemocaoDoProjeto(P, null);
    expect(await repo.listar(['removendo'])).toEqual([]);
    expect(await repo.listar(['removido'])).toHaveLength(3);
  });

  /** RN-1439: o overview lê o `removendo` do workspace, uma linha por projeto. */
  it('listarRemocoesPendentes agrupa por projeto, só do workspace, com nome e motivo', async () => {
    // Projeto próprio: `project_resources` não entra no truncateAll e o teste acima já usou P.
    const R = '55555555-5555-4555-8555-555555555555';
    const W = '22222222-2222-4222-8222-222222222222';
    await repo.gravar(R, 'container', '', { estado: 'criado' });
    await repo.gravar(R, 'container_qa', 'a1b2c3d4', { estado: 'criado' });
    await repo.marcarRemovendoDoProjeto(R, { workspaceId: W, nome: 'Loja' });
    await repo.concluirRemocaoDoProjeto(R, 'broker fora');
    const Q = '33333333-3333-4333-8333-333333333333';
    await repo.gravar(Q, 'container', '', { estado: 'criado' });
    await repo.marcarRemovendoDoProjeto(Q, {
      workspaceId: '44444444-4444-4444-8444-444444444444',
      nome: 'Outro',
    });
    const overview = new DrizzleContainersOverviewRepository(db);

    const [linha, ...resto] = await overview.listarRemocoesPendentes(W);

    expect(resto).toEqual([]);
    expect(linha).toMatchObject({
      projectId: R,
      projetoNome: 'Loja',
      recursos: 2,
      motivo: 'broker fora',
      tentativas: 1,
    });
    expect(linha.atualizadoEm).toBeInstanceOf(Date);
  });
});
