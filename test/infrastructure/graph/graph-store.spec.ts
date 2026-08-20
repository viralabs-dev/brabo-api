import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphUnavailableError } from '../../../src/domain/graph/graph-errors';
import { GraphStore } from '../../../src/infrastructure/graph/graph-store';

const verifyConnectivity = vi.fn();
const driverClose = vi.fn();
const sessionRun = vi.fn();
const sessionClose = vi.fn();
const executeWrite = vi.fn();
const executeRead = vi.fn();

const session = {
  run: sessionRun,
  close: sessionClose,
  executeWrite,
  executeRead,
};
const driverInstance = {
  verifyConnectivity,
  close: driverClose,
  session: () => session,
};
// Sem argumentos: nenhum teste aqui precisa inspecionar COM QUE uri/auth o
// driver foi chamado, só QUANTAS vezes — então não há por que o mock aceitar
// (e espalhar) argumentos que ele ignora.
const driverFactory = vi.fn(() => driverInstance);

vi.mock('neo4j-driver', () => ({
  default: {
    driver: () => driverFactory(),
    auth: { basic: (user: string, password: string) => ({ user, password }) },
    int: (n: number) => n,
    // Nenhum valor fake destes testes é um `neo4j.types.Integer` de verdade —
    // o caso real está coberto por `neo4j-integration.spec.ts`, contra o
    // driver de verdade.
    isInt: () => false,
  },
}));

const ENV_ORIGINAIS = { ...process.env };

function limparEnv() {
  delete process.env.NODE_ENV;
  delete process.env.NEO4J_URI;
  delete process.env.NEO4J_USER;
  delete process.env.NEO4J_PASSWORD;
}

function configurarEnv() {
  process.env.NODE_ENV = 'development';
  process.env.NEO4J_URI = 'bolt://localhost:7687';
  process.env.NEO4J_USER = 'neo4j';
  process.env.NEO4J_PASSWORD = 'senha-de-teste';
}

beforeEach(() => {
  vi.clearAllMocks();
  limparEnv();
});

afterEach(() => {
  process.env = { ...ENV_ORIGINAIS };
});

/**
 * `GraphStore` mockando o `neo4j-driver` inteiro — os testes de conexão REAL
 * ficam em `neo4j-integration.spec.ts` (pulado sem um Neo4j de pé). Aqui o
 * que importa é o contrato de DEGRADAÇÃO (RN da fundação do grafo): driver
 * ausente ou indisponível nunca propaga erro cru, sempre `GraphUnavailableError`.
 */
describe('GraphStore', () => {
  it('sem config (NEO4J_* ausentes), fica indisponível sem tentar conectar', async () => {
    limparEnv();
    process.env.NODE_ENV = 'test';
    const store = new GraphStore();
    await store.onModuleInit();

    expect(store.disponivel).toBe(false);
    expect(driverFactory).not.toHaveBeenCalled();
    await expect(
      store.executeWrite(() => Promise.resolve('x')),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
  });

  it('conexão falha (verifyConnectivity sempre rejeita) — fica indisponível, nunca lança no boot', async () => {
    configurarEnv();
    verifyConnectivity.mockRejectedValue(
      Object.assign(new Error('fora do ar'), { code: 'ServiceUnavailable' }),
    );
    const store = new GraphStore();
    await expect(store.onModuleInit()).resolves.toBeUndefined();

    expect(store.disponivel).toBe(false);
    await expect(
      store.executeWrite(() => Promise.resolve('x')),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
  });

  it('conexão bem-sucedida: fica disponível e roda o bootstrap de constraints', async () => {
    configurarEnv();
    verifyConnectivity.mockResolvedValue(undefined);
    sessionRun.mockResolvedValue({ records: [] });
    const store = new GraphStore();
    await store.onModuleInit();

    expect(store.disponivel).toBe(true);
    // As 5 constraints (4 pedidas + Interacao.sessionId) rodaram.
    expect(sessionRun).toHaveBeenCalledTimes(5);
    expect(sessionClose).toHaveBeenCalled();
  });

  it('executeWrite: adapta a transação e devolve o resultado do work', async () => {
    configurarEnv();
    verifyConnectivity.mockResolvedValue(undefined);
    sessionRun.mockResolvedValue({ records: [] });
    executeWrite.mockImplementation((work: (tx: unknown) => unknown) => {
      const tx = {
        run: () =>
          Promise.resolve({
            records: [
              { get: (k: string) => (k === 'nome' ? 'ok' : undefined) },
            ],
          }),
      };
      return Promise.resolve(work(tx));
    });

    const store = new GraphStore();
    await store.onModuleInit();

    const resultado = await store.executeWrite(async (tx) => {
      const r = await tx.run('RETURN 1 AS nome');
      return r.records[0].get<string>('nome');
    });
    expect(resultado).toBe('ok');
  });

  it('executeWrite: erro transitório na sessão é retentado e depois convertido em GraphUnavailableError se persistir', async () => {
    configurarEnv();
    verifyConnectivity.mockResolvedValue(undefined);
    sessionRun.mockResolvedValue({ records: [] });
    executeWrite.mockRejectedValue(
      Object.assign(new Error('sessão expirou'), { code: 'SessionExpired' }),
    );

    const store = new GraphStore();
    await store.onModuleInit();

    await expect(
      store.executeWrite(() => Promise.resolve('nunca chega aqui')),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
    // maxAttempts: 2 na camada de sessão do `executar` privado.
    expect(executeWrite).toHaveBeenCalledTimes(2);
  });

  it('executeWrite: erro NÃO transitório (ex.: Cypher inválido) não é retentado', async () => {
    configurarEnv();
    verifyConnectivity.mockResolvedValue(undefined);
    sessionRun.mockResolvedValue({ records: [] });
    executeWrite.mockRejectedValue(
      Object.assign(new Error('sintaxe inválida'), {
        code: 'Neo.ClientError.Statement.SyntaxError',
      }),
    );

    const store = new GraphStore();
    await store.onModuleInit();

    await expect(
      store.executeWrite(() => Promise.resolve('nunca chega aqui')),
    ).rejects.toBeInstanceOf(GraphUnavailableError);
    expect(executeWrite).toHaveBeenCalledTimes(1);
  });
});
