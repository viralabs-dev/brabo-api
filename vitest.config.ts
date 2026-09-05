import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    // 'forks' (child_process), não 'threads' (worker_threads): cada spec
    // roda em processo próprio, isolado de verdade — inclusive o `pg.Pool`
    // que cada arquivo abre em `createTestDb()`/`main.spec.ts`, que não
    // seria seguro compartilhar entre `worker_threads` do mesmo processo.
    // Isso já era verdade antes desta mudança; continua valendo agora que
    // fileParallelism está ligado, porque é o mesmo isolamento que faz
    // `VITEST_POOL_ID` (test/support/test-db-name.ts) corresponder a um
    // PROCESSO só, nunca a uma thread compartilhando memória com outra.
    pool: 'forks',
    // BANCO POR WORKER (perf/banco-por-worker-nos-testes-da-api): até aqui,
    // `fileParallelism: false` serializava os ~80 arquivos que importam
    // `test/support/test-db.ts` — todos batiam na MESMA `brabo_test` e
    // faziam TRUNCATE entre testes, e arquivos em paralelo colidiriam entre
    // si. A saída não foi sincronizar o TRUNCATE (serializaria de novo, só
    // que pior), foi dar a cada worker um banco EXCLUSIVO — ver
    // `test/support/global-setup.ts` (cria os bancos) e
    // `test/support/test-db-name.ts` (resolve qual banco é deste worker via
    // `VITEST_POOL_ID`). Sem banco compartilhado não há colisão para
    // sincronizar, e paralelizar deixa de custar corretude.
    fileParallelism: true,
    // Substitui `poolOptions.forks.maxForks`, que não existe mais no
    // Vitest 4 (o pool de workers virou uma opção só, de nível superior,
    // independente de qual `pool` está em uso — conferido lendo o `.d.ts`
    // publicado, não por suposição). 4 bate com as 4 vCPU do runner do
    // GitHub Actions (`test-api` do CI): medido localmente com 2/3/4 — 4 foi
    // o mais rápido e não estourou conexão nenhuma do Postgres do
    // container (cada worker abre poucas conexões, bem abaixo do
    // `max_connections` default). Não usar `process.env.CPU_COUNT`/auto-
    // detecção: o número tem que ser ESTÁVEL entre a máquina do dev (mais
    // núcleos) e o runner do CI (4 fixas), senão o comportamento medido
    // localmente não é o que roda lá.
    maxWorkers: 4,
    coverage: {
      provider: 'v8',
      // Piso (ratchet), não meta: o valor medido em 2026-08-27 foi statements
      // 82,4% / branches 71,86% / functions 76,81% / lines 83,41%, com a
      // suite inteira passando. Os números abaixo são esse valor arredondado
      // ~2 pontos PARA BAIXO — margem de segurança contra variação normal de
      // ambiente, nunca uma meta aspiracional. Ver CHANGELOG e a PR que
      // introduziu este piso para os números exatos.
      thresholds: {
        statements: 80,
        branches: 69,
        functions: 74,
        lines: 81,
      },
    },
  },
  plugins: [swc.vite()],
});
