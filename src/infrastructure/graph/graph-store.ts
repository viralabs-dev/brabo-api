import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import neo4j, {
  type Driver,
  type ManagedTransaction,
  type Session,
} from 'neo4j-driver';
import { GraphUnavailableError } from '../../domain/graph/graph-errors';
import { resolverConfigNeo4j } from './neo4j-config';
import { withRetry } from '../git/retry';

/**
 * O contrato mínimo que os casos de uso do grafo enxergam de uma transação —
 * um subconjunto ESTRUTURAL de `ManagedTransaction` do `neo4j-driver`, para
 * o tipo concreto do driver não vazar da infraestrutura para
 * `application/use-cases/graph/*` (mesmo motivo pelo qual `DrizzleDb` fica
 * todo confinado em `infrastructure/persistence`). Os testes de caso de uso
 * mockam ISTO — um objeto plano com `run` — nunca o driver de verdade.
 */
export interface GraphRecord {
  get<T = unknown>(key: string): T;
}
export interface GraphQueryResult {
  records: GraphRecord[];
}
export interface GraphTx {
  run(
    cypher: string,
    params?: Record<string, unknown>,
  ): Promise<GraphQueryResult>;
}

/**
 * `CREATE CONSTRAINT ... IF NOT EXISTS` (sintaxe Neo4j 5) é o bootstrap
 * idempotente do grafo — mesmo espírito do `CREATE TABLE IF NOT EXISTS` que
 * os módulos de persistência já usam em fixture, rodado no `onModuleInit`
 * como o `DomainGaugesCollector` já faz para o próprio ciclo de vida.
 *
 * As quatro constraints cobrem as chaves naturais que os casos de uso desta
 * fundação usam para idempotência: `PromptTemplate.name` (upsert por hash),
 * `Usuario.id`/`Projeto.id`/`Agente.slug` (nós compartilhados que várias
 * gravações fazem `MERGE` — sem a constraint, duas gravações concorrentes
 * poderiam criar dois nós `Usuario` com o mesmo id antes de qualquer uma
 * committar).
 */
const CONSTRAINTS: readonly string[] = [
  'CREATE CONSTRAINT prompt_template_name_unico IF NOT EXISTS FOR (t:PromptTemplate) REQUIRE t.name IS UNIQUE',
  'CREATE CONSTRAINT usuario_id_unico IF NOT EXISTS FOR (u:Usuario) REQUIRE u.id IS UNIQUE',
  'CREATE CONSTRAINT projeto_id_unico IF NOT EXISTS FOR (p:Projeto) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT agente_slug_unico IF NOT EXISTS FOR (a:Agente) REQUIRE a.slug IS UNIQUE',
  // Além do mínimo pedido: sem esta, o MERGE idempotente de `Interacao` por
  // `sessionId` (RecordInteractionUseCase) dependeria só da ausência de
  // corrida — a constraint torna a garantia estrutural, não uma esperança.
  // Só constraints de propriedade ÚNICA (não compostas/NODE KEY, que exigem
  // Neo4j Enterprise) — mesma restrição das quatro acima.
  'CREATE CONSTRAINT interacao_sessionid_unico IF NOT EXISTS FOR (i:Interacao) REQUIRE i.sessionId IS UNIQUE',
];

/**
 * Encapsula o driver do Neo4j (grafo de conhecimento — memória DERIVADA do
 * event log, nunca fonte de verdade).
 *
 * ## Degradação, não crash
 *
 * `onModuleInit` NUNCA lança: se `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`
 * estiverem ausentes (permitido fora de produção, ver `neo4j-config.ts`) ou a
 * conexão falhar, o driver fica `null` e toda chamada a `executeRead`/
 * `executeWrite` lança `GraphUnavailableError` na hora, sem tocar rede — quem
 * chama (os casos de uso em `application/use-cases/graph/`) converte isso em
 * resposta degradada.
 *
 * ## Retry
 *
 * `session.executeWrite`/`executeRead` do driver JÁ retentam erros
 * transitórios de transação internamente (é o motivo de existirem, em vez de
 * `beginTransaction` cru). O `withRetry` aqui é uma segunda camada, mais
 * grosseira, que cobre o que a transação não cobre: a CRIAÇÃO da sessão
 * (`driver.session()`) falhando porque o servidor acabou de cair, por
 * exemplo. Só reentra em erro classificado como transitório
 * (`ServiceUnavailable`/`SessionExpired`/`Neo.TransientError.*`) — nunca em
 * erro de sintaxe Cypher ou de constraint violada, que são bugs, não
 * indisponibilidade.
 */
@Injectable()
export class GraphStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphStore.name);
  private driver: Driver | null = null;

  async onModuleInit(): Promise<void> {
    const config = resolverConfigNeo4j();
    if (!config) {
      this.logger.warn(
        'NEO4J_URI/NEO4J_USER/NEO4J_PASSWORD ausentes — grafo de conhecimento ' +
          'desligado nesta instância (as rotas dependentes degradam).',
      );
      return;
    }

    try {
      const driver = neo4j.driver(
        config.uri,
        neo4j.auth.basic(config.user, config.password),
      );
      await withRetry(() => driver.verifyConnectivity(), {
        maxAttempts: 3,
        baseDelayMs: 300,
      });
      this.driver = driver;
      await this.bootstrapConstraints();
      this.logger.log('Neo4j conectado — constraints do grafo garantidas.');
    } catch (erro) {
      this.driver = null;
      this.logger.error(
        `Falha ao conectar ao Neo4j — grafo segue desligado: ${descreverErro(erro)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver?.close();
  }

  /** Só para diagnóstico/health — os casos de uso não precisam checar antes de chamar. */
  get disponivel(): boolean {
    return this.driver !== null;
  }

  private async bootstrapConstraints(): Promise<void> {
    if (!this.driver) return;
    const session = this.driver.session();
    try {
      for (const cypher of CONSTRAINTS) {
        await session.run(cypher);
      }
    } finally {
      await session.close();
    }
  }

  async executeWrite<T>(work: (tx: GraphTx) => Promise<T>): Promise<T> {
    return this.executar((session) =>
      session.executeWrite((tx) => work(adaptarTransacao(tx))),
    );
  }

  async executeRead<T>(work: (tx: GraphTx) => Promise<T>): Promise<T> {
    return this.executar((session) =>
      session.executeRead((tx) => work(adaptarTransacao(tx))),
    );
  }

  private async executar<T>(
    work: (session: Session) => Promise<T>,
  ): Promise<T> {
    if (!this.driver) {
      throw new GraphUnavailableError(
        'Neo4j não está configurado ou não conectou nesta instância.',
      );
    }
    const driver = this.driver;
    try {
      return await withRetry(
        async () => {
          const session = driver.session();
          try {
            return await work(session);
          } finally {
            await session.close();
          }
        },
        { maxAttempts: 2, baseDelayMs: 200, shouldRetry: erroTransitorio },
      );
    } catch (erro) {
      if (erro instanceof GraphUnavailableError) throw erro;
      throw new GraphUnavailableError('Operação no grafo falhou.', erro);
    }
  }
}

function adaptarTransacao(tx: ManagedTransaction): GraphTx {
  return {
    async run(cypher, params) {
      const resultado = await tx.run(cypher, params);
      return {
        records: resultado.records.map((registro) => ({
          get: <T>(key: string) => converterInteiros(registro.get(key)) as T,
        })),
      };
    },
  };
}

/**
 * O driver devolve todo valor Cypher `Integer` (ex.: `count()`, `id()`) como
 * um objeto `neo4j.types.Integer` — não um `number` — para não perder
 * precisão em inteiros maiores que `Number.MAX_SAFE_INTEGER`. Achado pelo
 * teste de integração real (`neo4j-integration.spec.ts`): um `count(t)`
 * comparado com `toBe(1)` falhava porque o valor NUNCA foi um número
 * primitivo. Convertido aqui, uma vez, para nenhum caso de uso ter que saber
 * disso — nenhum valor que este produto grava usa `neo4j.int()`/
 * `toInteger()` de propósito (todo `seq`/`seqInicio`/`seqFim` é gravado como
 * Float, que o driver JÁ devolve como `number` puro), então só funções
 * embutidas do Cypher produzem Integer de volta.
 *
 * Só top-level e dentro de array (`collect()`): NÃO recursa em objeto
 * genérico — um valor `DateTime` (ex.: `PromptVersion.createdAt`) é um
 * objeto com método `toString()` próprio, e desmontá-lo em
 * `Object.fromEntries` quebraria esse método.
 */
function converterInteiros<T>(valor: T): T {
  if (neo4j.isInt(valor)) {
    return (
      valor as unknown as { toNumber(): number }
    ).toNumber() as unknown as T;
  }
  if (Array.isArray(valor)) {
    return (valor as unknown[]).map((item) =>
      converterInteiros(item),
    ) as unknown as T;
  }
  return valor;
}

function erroTransitorio(erro: unknown): boolean {
  const codigo = (erro as { code?: string } | undefined)?.code ?? '';
  return (
    codigo === 'ServiceUnavailable' ||
    codigo === 'SessionExpired' ||
    codigo.includes('TransientError')
  );
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
