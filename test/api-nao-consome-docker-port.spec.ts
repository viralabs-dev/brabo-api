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
 *
 * ## O que este invariante NÃO proíbe, e por quê
 *
 * Um TESTE da api importar o pacote por caminho RELATIVO — que é o que
 * `test/contract/especificacao-de-container-para-runner.contract.spec.ts` faz
 * para provar a corrente `container_start_via_runner` contra o validador de
 * verdade. Nada disso chega ao `/prod`: não há linha em manifesto nenhum
 * (o primeiro caso abaixo continua sendo a garantia), `tsconfig.build.json`
 * exclui `test/`, e o `Dockerfile.prod` copia `dist` mais as deps de
 * produção, nunca a pasta de testes. O que quebraria a produção é `src/`
 * alcançar o pacote — por NOME ou por caminho relativo —, e o segundo caso
 * abaixo passou a cobrir as duas formas: antes ele procurava só o nome do
 * pacote, e um `import … from '../../../packages/docker-port/…'` dentro de
 * `src/` teria passado batido, com o mesmo desfecho no boot (o `dist` da api
 * apontando para um arquivo que a imagem não tem).
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

  it('nenhum arquivo de `src/` o importa — nem por nome, nem por caminho relativo', () => {
    // `git grep` e não uma varredura própria: ele respeita o que está
    // rastreado e não enxerga `node_modules`, `dist` nem arquivo de build.
    //
    // Os DOIS padrões, porque as duas formas produzem o MESMO boot morto: o
    // nome do pacote resolve pelo `main` que aponta para `.ts` cru, e um
    // caminho relativo para `packages/docker-port` sai da árvore que o
    // `Dockerfile.prod` copia — o `dist` da api referenciaria um arquivo que
    // não existe na imagem.
    const buscar = (argumentos: string[]): string[] => {
      try {
        return execFileSync(
          'git',
          ['grep', '-l', ...argumentos, '--', 'apps/api/src'],
          { cwd: join(raizDaApi, '../..'), encoding: 'utf8' },
        )
          .split('\n')
          .filter(Boolean);
      } catch {
        // `git grep` sai com código 1 quando não encontra nada — que é o caso
        // esperado, e o único desfecho que passa.
        return [];
      }
    };

    // O nome do pacote é procurado LITERAL, inclusive em comentário: `src/`
    // não tem por que citá-lo, e a busca cega é a mais difícil de burlar.
    expect(buscar(['-e', '@brabo/docker-port'])).toEqual([]);

    // O caminho relativo, ao contrário, aparece LEGITIMAMENTE em prosa (a
    // porta da api explica de onde vem o vocabulário que ela espelha), então
    // aqui a busca é pela FORMA de import — que é o que de fato quebraria o
    // boot, e é o que a busca literal não conseguiria distinguir.
    expect(
      buscar([
        '-E',
        '-e',
        `(from|import|require\\()[ \\t]*['"][^'"]*packages/docker-port`,
      ]),
    ).toEqual([]);
  });
});
