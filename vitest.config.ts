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
  },
  plugins: [swc.vite()],
});
