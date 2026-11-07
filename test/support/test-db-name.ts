// Nomeação de banco por WORKER (perf/banco-por-worker-nos-testes-da-api).
//
// `global-setup.ts` (que CRIA os bancos) e `test-db.ts` (que cada spec usa
// para CONECTAR) precisam concordar no NOME sem se importarem um do outro —
// um importaria o outro por acidente e criaria acoplamento que não existe
// hoje. Este arquivo pequeno é a fonte única dos dois lados.
//
// `TEST_DATABASE_URL` continua sendo a variável de sempre (CI e `.env` não
// mudam), mas o que ela nomeia MUDA de sentido: antes era o banco único de
// teste, agora é só a BASE do nome — o banco de onde os nomes de template e
// de worker são derivados, nunca um banco que alguém conecta direto.
/**
 * Decide se o ambiente pode rodar os testes (AT-775). Função pura: devolve a
 * mensagem de recusa, ou `null` se pode seguir. Teste nunca cai no Postgres da
 * instalação (`localhost:5432`, banco `brabo`), então não há fallback de URL.
 */
export function refusalReason(env: {
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  BRABO_TESTE_PERMITE_5432?: string;
}): string | null {
  const como =
    'Suba um Postgres descartável sem porta publicada, p.ex. ' +
    '`docker run -d --name pg-teste -e POSTGRES_PASSWORD=x pgvector/pgvector:pg16`, ' +
    'e aponte DATABASE_URL e TEST_DATABASE_URL para o IP do container ' +
    '(`docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" pg-teste`).';
  if (!env.DATABASE_URL || !env.TEST_DATABASE_URL) {
    return `DATABASE_URL e TEST_DATABASE_URL são obrigatórias nos testes (sem fallback para localhost:5432, o Postgres da instalação). ${como}`;
  }
  for (const url of [env.DATABASE_URL, env.TEST_DATABASE_URL]) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return `URL de banco inválida nos testes. ${como}`;
    }
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
      parsed.hostname,
    );
    if (
      local &&
      (parsed.port || '5432') === '5432' &&
      !env.BRABO_TESTE_PERMITE_5432
    ) {
      return `${parsed.hostname}:5432 pode ser o Postgres da instalação; recusado. Se for um Postgres descartável (service do CI), defina BRABO_TESTE_PERMITE_5432=1. ${como}`;
    }
  }
  const testDb = new URL(env.TEST_DATABASE_URL).pathname.slice(1);
  if (testDb === 'brabo') {
    return `TEST_DATABASE_URL aponta para o banco "brabo" (o da instalação); use outro nome, p.ex. brabo_test. ${como}`;
  }
  return null;
}

const refusal = refusalReason(process.env);
if (refusal) throw new Error(refusal);

const BASE_TEST_DATABASE_URL = process.env.TEST_DATABASE_URL as string;

function parseDatabaseUrl(url: string): { prefix: string; dbName: string } {
  const lastSlash = url.lastIndexOf('/');
  return { prefix: url.slice(0, lastSlash), dbName: url.slice(lastSlash + 1) };
}

const { prefix: CONNECTION_PREFIX, dbName: BASE_DATABASE_NAME } =
  parseDatabaseUrl(BASE_TEST_DATABASE_URL);

/** Nome antigo (`brabo_test`) — mantido de pé só para o fallback abaixo. */
export const LEGACY_DATABASE_NAME = BASE_DATABASE_NAME;
export const LEGACY_DATABASE_URL = BASE_TEST_DATABASE_URL;

/**
 * Banco migrado UMA VEZ; cada banco de worker nasce como CÓPIA DE PÁGINA dele
 * (`CREATE DATABASE ... TEMPLATE`), nunca de um replay de migration — é isso
 * que torna barato criar vários.
 */
export const TEMPLATE_DATABASE_NAME = `${BASE_DATABASE_NAME}_template`;
export const TEMPLATE_DATABASE_URL = `${CONNECTION_PREFIX}/${TEMPLATE_DATABASE_NAME}`;

/**
 * Número FIXO de bancos criados no globalSetup, não sob demanda: o Vitest só
 * revela quantos workers vai usar depois que o pool já está distribuindo
 * arquivos, e o primeiro spec de cada worker não pode ficar esperando uma
 * criação de banco concorrente (duas cópias do MESMO template ao mesmo tempo
 * colidiriam). Bate com `maxWorkers` de `vitest.config.ts` — sobrar banco não
 * usado (ambiente com menos CPU) é inofensivo; faltar não é opção.
 */
export const MAX_WORKER_DATABASES = 4;

export function workerDatabaseName(workerId: number): string {
  return `${BASE_DATABASE_NAME}_w${workerId}`;
}

export function workerDatabaseUrl(workerId: number): string {
  return `${CONNECTION_PREFIX}/${workerDatabaseName(workerId)}`;
}

/**
 * Resolve o banco que ESTE processo deve usar. `VITEST_POOL_ID` é setado
 * pelo Vitest a cada fork do pool `forks` — valor estável entre 1 e
 * `maxWorkers` durante a vida do worker (confirmado lendo
 * `vitest/dist/chunks/cli-api.*.js`: "Value is between 1-maxWorkers"), o que
 * é exatamente o que faz um banco por worker funcionar: todo spec que esse
 * fork rodar usa o MESMO banco, e specs de forks diferentes nunca dividem
 * banco.
 *
 * Fora do Vitest (spec avulso rodado por outra ferramenta, ambiente antigo
 * sem esta mudança) a variável não existe — cai no nome antigo `brabo_test`
 * para não quebrar quem chama `createTestDb()`/`truncateAll()` fora do fluxo
 * normal; `global-setup.ts` mantém esse banco de pé só por causa disto.
 */
export function resolveDatabaseUrlForCurrentWorker(): string {
  const poolId = process.env.VITEST_POOL_ID;
  if (!poolId) return LEGACY_DATABASE_URL;

  const workerId = Number(poolId);
  if (!Number.isInteger(workerId) || workerId < 1) return LEGACY_DATABASE_URL;

  return workerDatabaseUrl(workerId);
}
