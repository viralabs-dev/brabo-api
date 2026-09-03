import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb, truncateAll } from '../../../support/test-db';
import {
  projectContainers,
  projects,
  proposedActions,
  sessionEvents,
  sessions,
  users,
  workspaces,
} from '../../../../src/db/schema';
import { DrizzleContainersOverviewRepository } from '../../../../src/infrastructure/persistence/drizzle/containers-overview.repository';
import { EVENTO_IMAGEM_DO_PROJETO } from '../../../../src/domain/containers/project-container';

const { db, pool } = createTestDb();
const repo = new DrizzleContainersOverviewRepository(db);

let seq = 0;

async function criarUsuario(email: string) {
  const [row] = await db
    .insert(users)
    .values({ keycloakSub: `sub-${email}`, email, name: email })
    .returning();
  return row;
}

async function criarWorkspace(ownerId: string, slug: string) {
  const [row] = await db
    .insert(workspaces)
    .values({ name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function criarProjeto(workspaceId: string, ownerId: string, slug: string) {
  const [row] = await db
    .insert(projects)
    .values({ workspaceId, name: slug, slug, createdBy: ownerId })
    .returning();
  return row;
}

async function criarSessao(projectId: string, ownerId: string) {
  const [row] = await db
    .insert(sessions)
    .values({ projectId, createdBy: ownerId })
    .returning();
  return row;
}

async function criarCicloDeVida(
  projectId: string,
  status: 'provisioning' | 'running' | 'stopped' | 'failed' | 'removed',
  imageVersion: number,
) {
  const [row] = await db
    .insert(projectContainers)
    .values({
      projectId,
      status,
      imageVersion,
      cpus: 2,
      memoryMb: 4096,
      pidsLimit: 512,
    })
    .returning();
  return row;
}

async function gravarDecisaoDeImagem(
  sessionId: string,
  version: number,
  image: string,
) {
  seq += 1;
  await db.insert(sessionEvents).values({
    id: `evt-img-${seq}`,
    sessionId,
    seq,
    type: EVENTO_IMAGEM_DO_PROJETO,
    actorKind: 'agent',
    actorId: 'arquiteto',
    payload: {
      image,
      rationale: 'stack combina com o módulo',
      network: 'none',
      resources: { cpus: 2, memoryMb: 4096, pidsLimit: 512 },
      version,
    },
  });
}

async function criarAcaoDeContainer(
  projectId: string,
  sessionId: string,
  actionType: 'container_start' | 'container_stop' | 'container_remove',
  status: 'pending' | 'approved' | 'executed' = 'pending',
) {
  const [row] = await db
    .insert(proposedActions)
    .values({
      projectId,
      sessionId,
      actionType,
      resolvedPolicy: 'require_approval',
      actorKind: 'user',
      actorId: 'user-1',
      status,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await truncateAll(db);
  seq = 0;
});

afterAll(async () => {
  await pool.end();
});

describe('DrizzleContainersOverviewRepository', () => {
  it('workspace sem projeto nenhum com ciclo de vida: lista vazia', async () => {
    const owner = await criarUsuario('vazio@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'vazio');
    await criarProjeto(ws.id, owner.id, 'sem-container');

    expect(await repo.listForWorkspace(ws.id)).toEqual([]);
  });

  it('só entram projetos que JÁ TÊM project_containers — a régua da tela', async () => {
    const owner = await criarUsuario('regua@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'regua');
    const comContainer = await criarProjeto(ws.id, owner.id, 'com-container');
    await criarProjeto(ws.id, owner.id, 'sem-container');
    await criarCicloDeVida(comContainer.id, 'running', 1);

    const linhas = await repo.listForWorkspace(ws.id);

    expect(linhas.map((l) => l.projectId)).toEqual([comContainer.id]);
  });

  it('resolve a imagem CONGELADA na imageVersion, não a mais recente', async () => {
    const owner = await criarUsuario('congelado@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'congelado');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);

    await gravarDecisaoDeImagem(sessao.id, 1, 'node:20-slim');
    await gravarDecisaoDeImagem(sessao.id, 2, 'node:22-bookworm-slim');
    // O container nasceu na v1 — o Arquiteto revisou DEPOIS, para a v2.
    await criarCicloDeVida(projeto.id, 'running', 1);

    const [linha] = await repo.listForWorkspace(ws.id);

    expect(linha.imagem).toBe('node:20-slim');
    expect(linha.lifecycle.imageVersion).toBe(1);
  });

  it('versão sem evento correspondente: imagem null, nunca inventada', async () => {
    const owner = await criarUsuario('semevento@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'semevento');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarCicloDeVida(projeto.id, 'running', 1);

    const [linha] = await repo.listForWorkspace(ws.id);

    expect(linha.imagem).toBeNull();
  });

  it('acaoPendente traz a proposed_action pendente de container, em QUALQUER sessão do projeto', async () => {
    const owner = await criarUsuario('pendente@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'pendente');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    const sessao = await criarSessao(projeto.id, owner.id);
    await criarCicloDeVida(projeto.id, 'running', 1);

    const acao = await criarAcaoDeContainer(
      projeto.id,
      sessao.id,
      'container_stop',
      'pending',
    );
    // Já decidida — não deve aparecer.
    await criarAcaoDeContainer(
      projeto.id,
      sessao.id,
      'container_start',
      'executed',
    );

    const [linha] = await repo.listForWorkspace(ws.id);

    expect(linha.acaoPendente?.id).toBe(acao.id);
    expect(linha.acaoPendente?.actionType).toBe('container_stop');
  });

  it('sem ação pendente: acaoPendente é null', async () => {
    const owner = await criarUsuario('semacao@brabo.dev');
    const ws = await criarWorkspace(owner.id, 'semacao');
    const projeto = await criarProjeto(ws.id, owner.id, 'core');
    await criarCicloDeVida(projeto.id, 'running', 1);

    const [linha] = await repo.listForWorkspace(ws.id);

    expect(linha.acaoPendente).toBeNull();
  });

  it('não vaza projeto de outro workspace', async () => {
    const owner = await criarUsuario('isolado@brabo.dev');
    const a = await criarWorkspace(owner.id, 'ws-a');
    const b = await criarWorkspace(owner.id, 'ws-b');
    const doA = await criarProjeto(a.id, owner.id, 'core');
    const doB = await criarProjeto(b.id, owner.id, 'core');
    await criarCicloDeVida(doA.id, 'running', 1);
    await criarCicloDeVida(doB.id, 'running', 1);

    const linhas = await repo.listForWorkspace(a.id);

    expect(linhas.map((l) => l.projectId)).toEqual([doA.id]);
  });

  /**
   * A propriedade que a leitura inteira depende, mesmo molde de
   * `DrizzleProjectsSummaryRepository`: TRÊS consultas, quantos projetos
   * forem — nunca uma dentro de laço.
   */
  it('o número de consultas NÃO cresce com a quantidade de projetos', async () => {
    const contarConsultas = async (n: number): Promise<number> => {
      await truncateAll(db);
      seq = 0;
      const owner = await criarUsuario(`escala-${n}@brabo.dev`);
      const ws = await criarWorkspace(owner.id, `escala-${n}`);
      for (let i = 0; i < n; i++) {
        const p = await criarProjeto(ws.id, owner.id, `p-${i}`);
        const s = await criarSessao(p.id, owner.id);
        await gravarDecisaoDeImagem(s.id, 1, 'node:22-bookworm-slim');
        await criarCicloDeVida(p.id, 'running', 1);
        await criarAcaoDeContainer(p.id, s.id, 'container_stop', 'pending');
      }

      const original = pool.query.bind(pool);
      let consultas = 0;
      (pool as { query: unknown }).query = (...args: unknown[]) => {
        consultas += 1;
        return (original as (...a: unknown[]) => unknown)(...args);
      };
      try {
        const linhas = await repo.listForWorkspace(ws.id);
        expect(linhas).toHaveLength(n);
      } finally {
        (pool as { query: unknown }).query = original;
      }
      return consultas;
    };

    const comDois = await contarConsultas(2);
    const comVinte = await contarConsultas(20);

    expect(comVinte).toBe(comDois);
    expect(comDois).toBeGreaterThan(0);
  });
});
