import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import neo4j, { type Driver } from 'neo4j-driver';
import { GraphStore } from '../../../src/infrastructure/graph/graph-store';

/**
 * Integração REAL contra um Neo4j de pé — fundação do grafo de conhecimento.
 *
 * A frente N1 (paralela) está subindo o serviço `neo4j` no
 * `docker-compose.yml`; este arquivo não espera por ela: tenta conectar com
 * um teste de conectividade CURTO (2s) e, se não conseguir, pula CADA teste
 * dinamicamente (`ctx.skip()`, dentro de `beforeAll`) — mesmo espírito dos
 * smokes de provider LLM/git em `test/infrastructure/{llm,git}/*.smoke.spec.ts`,
 * com uma diferença: ali o gatilho é uma env var de opt-in manual (rodar
 * contra credencial de verdade custa dinheiro); aqui não há custo nenhum em
 * TENTAR — só pula se a tentativa falhar de verdade.
 *
 * `describe.skipIf` exigiria decidir a condição ANTES da suite ser montada —
 * ou seja, `await` no topo do módulo. Este pacote não é ESM
 * (`package.json` sem `"type": "module"`), e sob `module: nodenext` o `tsc`
 * recusa top-level `await` num módulo CommonJS (TS1309) — o SWC do vitest
 * tolera em runtime, mas `tsc -b --force` (o typecheck real do CI/imagem,
 * ver nota da Fase X sobre "typecheck local não é o do CI") reprovaria. Por
 * isso a checagem de conectividade mora em `beforeAll`, e cada teste decide
 * pular a si mesmo lendo uma flag de módulo.
 *
 * Para rodar de propósito: suba o Neo4j do compose (`docker compose up -d
 * neo4j`, quando a frente N1 tiver aterrissado) e rode
 * `pnpm --filter api test -- neo4j-integration`.
 */
const URI = process.env.NEO4J_URI ?? 'bolt://localhost:7687';
const USER = process.env.NEO4J_USER ?? 'neo4j';
const PASSWORD = process.env.NEO4J_PASSWORD ?? 'neo4j';

async function neo4jAlcancavel(): Promise<boolean> {
  let driver: Driver | undefined;
  try {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
    await Promise.race([
      driver.verifyConnectivity(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout de 2s')), 2000),
      ),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    await driver?.close();
  }
}

describe('GraphStore — integração real (Neo4j de pé)', () => {
  let store: GraphStore;
  let alcancavel = false;

  beforeAll(async () => {
    alcancavel = await neo4jAlcancavel();
    if (!alcancavel) {
      console.warn(
        `[integração] Neo4j não alcançável em ${URI} — pulando os testes de ` +
          'integração real do grafo de conhecimento. Isto é ESPERADO se a ' +
          'frente que sobe o serviço `neo4j` no docker-compose ainda não ' +
          'aterrissou, ou se você não rodou `docker compose up -d neo4j`. ' +
          'Nenhuma parte da fundação do grafo depende deste teste passar ' +
          'para ser aceita — ver o resumo da entrega.',
      );
      return;
    }

    process.env.NEO4J_URI = URI;
    process.env.NEO4J_USER = USER;
    process.env.NEO4J_PASSWORD = PASSWORD;
    store = new GraphStore();
    await store.onModuleInit();
  }, 15_000);

  afterAll(async () => {
    await store?.onModuleDestroy();
  });

  it('conecta e fica disponível', (ctx) => {
    if (!alcancavel) return ctx.skip();
    expect(store.disponivel).toBe(true);
  });

  it('bootstrap idempotente: rodar onModuleInit de novo não falha', async (ctx) => {
    if (!alcancavel) return ctx.skip();
    const outraInstancia = new GraphStore();
    await expect(outraInstancia.onModuleInit()).resolves.toBeUndefined();
    expect(outraInstancia.disponivel).toBe(true);
    await outraInstancia.onModuleDestroy();
  });

  it('escreve e lê de volta um nó real, e o MERGE não duplica em replay', async (ctx) => {
    if (!alcancavel) return ctx.skip();
    const nome = `teste-integracao-${Date.now()}`;
    const escrever = () =>
      store.executeWrite((tx) =>
        tx.run(`MERGE (t:PromptTemplate {name: $nome}) RETURN t.name AS nome`, {
          nome,
        }),
      );

    await escrever();
    await escrever(); // replay — não deve duplicar

    const contagem = await store.executeRead((tx) =>
      tx.run(
        `MATCH (t:PromptTemplate {name: $nome}) RETURN count(t) AS total`,
        { nome },
      ),
    );
    expect(contagem.records[0].get<number>('total')).toBe(1);

    // limpeza — não deixar sujeira num banco de dev compartilhado.
    await store.executeWrite((tx) =>
      tx.run(`MATCH (t:PromptTemplate {name: $nome}) DETACH DELETE t`, {
        nome,
      }),
    );
  });
});
