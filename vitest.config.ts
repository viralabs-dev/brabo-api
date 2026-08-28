import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 15_000,
    pool: 'forks',
    // Vários specs batem na mesma brabo_test e fazem TRUNCATE entre
    // testes — arquivos em paralelo colidiriam entre si.
    fileParallelism: false,
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
