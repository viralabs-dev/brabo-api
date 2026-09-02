import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A api NÃO pode depender de `@brabo/docker-port`.
 *
 * ## Por que isto é um teste, e não um comentário
 *
 * É o irmão de `packages-shared-so-tipos.spec.ts`, e existe pelo MESMO erro de
 * produção que aquele previne, visto do outro lado. `packages/shared` é 100%
 * tipo porque o `main` dele aponta para `.ts` cru e o Node se recusa a fazer
 * type stripping dentro de `node_modules`:
 *
 *     ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *     .../node_modules/@brabo/shared/src/index.ts
 *
 * `packages/docker-port` (ADR 0130) tem exatamente o mesmo `main` apontando
 * para `.ts` cru — e, ao contrário do shared, ele é código de RUNTIME de ponta
 * a ponta: classes de erro, constantes, funções de validação. Nada ali some na
 * compilação.
 *
 * Isso funciona para `apps/runner` e `apps/broker` porque os dois EMPACOTAM o
 * pacote (`tsup`, `bun build --compile`) — o `require` nunca acontece. A api
 * não empacota: o `Dockerfile.prod` dela faz `pnpm deploy --prod`, que copia o
 * pacote de VERDADE para `node_modules` (sem symlink, de propósito — symlink
 * para fora do contexto quebraria). Aí o `realpath` cai dentro de
 * `node_modules` e o boot morre.
 *
 * O caminho que a api usa para falar com o broker é HTTP
 * (`ContainerBrokerPort` + `HttpContainerBrokerClient`), e os TIPOS que ela
 * precisa estão declarados na porta dela mesma. Se um dia for preciso mesmo
 * compartilhar valor entre a api e o broker, aí é decisão estrutural: dar um
 * passo de build ao pacote (com `main` apontando para `dist`) e registrar o
 * ADR — a mesma saída que o docblock do `packages-shared-so-tipos.spec.ts`
 * indica para o caso dele.
 */
describe('a api não consome @brabo/docker-port', () => {
  const raizDaApi = join(__dirname, '..');

  it('não declara o pacote em dependência nenhuma', () => {
    const manifesto = JSON.parse(
      readFileSync(join(raizDaApi, 'package.json'), 'utf8'),
    ) as Record<string, Record<string, string> | undefined>;

    const todas = [
      ...Object.keys(manifesto.dependencies ?? {}),
      ...Object.keys(manifesto.devDependencies ?? {}),
      ...Object.keys(manifesto.peerDependencies ?? {}),
    ];

    expect(todas).not.toContain('@brabo/docker-port');
  });

  it('nenhum arquivo de `src/` o importa', () => {
    // `git grep` e não uma varredura própria: ele respeita o que está
    // rastreado e não enxerga `node_modules`, `dist` nem arquivo de build.
    let saida = '';
    try {
      saida = execFileSync(
        'git',
        ['grep', '-l', '@brabo/docker-port', '--', 'apps/api/src'],
        { cwd: join(raizDaApi, '../..'), encoding: 'utf8' },
      );
    } catch {
      // `git grep` sai com código 1 quando não encontra nada — que é o caso
      // esperado, e o único desfecho que passa.
      saida = '';
    }

    expect(saida.split('\n').filter(Boolean)).toEqual([]);
  });
});
