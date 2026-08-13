import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * O cabeçalho de `git-provider.contract.ts` lista quem exercita a suite de
 * contrato. Essa lista já mentiu uma vez — dizia que só o `LocalGitProvider`
 * a rodava, quando GitHub e GitLab a rodam desde a Fase 2 (achado #8 do
 * primeiro dogfooding).
 *
 * O consertado seria mentir de novo no dia em que um provider novo entrasse
 * (Bitbucket e Generic são fase declarada). Então a lista deixa de ser prosa
 * confiada à disciplina de quem edita e passa a ser verificada: este teste
 * varre `test/` atrás de quem chama `runGitProviderContract` e compara com o
 * que o cabeçalho promete.
 */
describe('cabeçalho da suite de contrato × quem realmente a chama', () => {
  const raizDosTestes = join(__dirname, '..');

  const arquivosDeTeste = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const caminho = join(dir, e.name);
      if (e.isDirectory()) return arquivosDeTeste(caminho);
      return e.isFile() && caminho.endsWith('.spec.ts') ? [caminho] : [];
    });

  /** Specs que de fato invocam a suite, em caminho relativo a `apps/api/`. */
  const chamadoresReais = (): string[] =>
    arquivosDeTeste(raizDosTestes)
      // Este próprio arquivo cita o nome da função em prosa e em regex; ele
      // não é chamador.
      .filter((f) => f !== __filename)
      .filter((f) => /\brunGitProviderContract\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => `test/${relative(raizDosTestes, f).split('\\').join('/')}`)
      .sort();

  /** Os caminhos citados na lista do moduledoc, na ordem em que aparecem. */
  const chamadoresPrometidos = (): string[] => {
    const cabecalho = readFileSync(join(__dirname, 'git-provider.contract.ts'), 'utf8');
    return [...cabecalho.matchAll(/^ \* - `(test\/[^`]+\.spec\.ts)`/gm)]
      .map((m) => m[1])
      .sort();
  };

  it('não promete um chamador que não existe, nem esconde um que existe', () => {
    expect(chamadoresPrometidos()).toEqual(chamadoresReais());
  });

  it('a suite é exercitada por mais de um provider — o ponto dela', () => {
    expect(chamadoresReais().length).toBeGreaterThan(1);
  });
});

/**
 * A segunda trava, e o item 33 da FASE 26: **operação de contrato sem
 * consumidor reprova o CI**.
 *
 * O motivo é o mesmo que o `@Catch` morto do `GitProviderErrorFilter` e o
 * glob morto do docmap já aplicam: uma operação que os três providers
 * implementam e que NINGUÉM chama é peso permanente — cada provider novo
 * paga por ela, e nada prova que ela funciona no caminho real. A FASE 14d
 * fechou três lacunas exatamente assim ("nenhuma rota chamava o caso de
 * uso"): testar a peça não é testar o caminho até ela.
 *
 * Mas a fase é cortada por ARQUIVO DISPUTADO, e a 26a entrega o contrato
 * enquanto a 26b entrega as rotas. Então a trava tem uma saída ESTREITA:
 * `SEM_CONSUMIDOR_AINDA`, onde cada operação entra NOMEADA, com a fase que a
 * consome escrita ao lado. E a saída se fecha sozinha — o segundo teste
 * reprova quando uma operação da lista JÁ tem consumidor, obrigando a 26b a
 * apagar a entrada em vez de deixá-la apodrecer.
 *
 * **A saída fechou, e o mecanismo funcionou como escrito.** A FASE 26b deu
 * consumidor às duas — `listTree` e `getPullRequestDiff` são chamadas por
 * `application/use-cases/git/read-project-code.use-case.ts`, que é a superfície
 * de leitura da aba Code. A lista está vazia porque foi ESVAZIADA pelo segundo
 * teste, não porque alguém lembrou: assim que a rota passou a existir, ele
 * reprovou apontando as duas entradas pelo nome. Deixá-la vazia (em vez de
 * apagar o mapa) é o que mantém a saída disponível para o próximo contrato que
 * nascer antes do seu consumidor — com a mesma obrigação de fechar.
 */
describe('operações do GitProviderContract × quem as consome em src/', () => {
  const raizDoRepo = join(__dirname, '../../../..');
  const raizDoSrc = join(__dirname, '../../src');

  /**
   * Declarado, consumidor ainda por vir.
   *
   * VAZIO desde a FASE 26b: as duas entradas que a 26a deixou aqui
   * (`listTree` e `getPullRequestDiff`) ganharam consumidor em
   * `read-project-code.use-case.ts` e saíram. Operação nova que nasça sem
   * consumidor entra aqui NOMEADA, com a fase que a consome ao lado — e sai
   * quando a fase chegar, porque o segundo teste não deixa ficar.
   */
  const SEM_CONSUMIDOR_AINDA: Record<string, string> = {};

  const arquivosTs = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const caminho = join(dir, e.name);
      if (e.isDirectory()) return arquivosTs(caminho);
      return e.isFile() && caminho.endsWith('.ts') ? [caminho] : [];
    });

  const operacoesDoContrato = (): string[] => {
    const fonte = ts.createSourceFile(
      'index.ts',
      readFileSync(join(raizDoRepo, 'packages/shared/src/index.ts'), 'utf8'),
      ts.ScriptTarget.ESNext,
      true,
    );
    const contrato = fonte.statements
      .filter(ts.isInterfaceDeclaration)
      .find((i) => i.name.text === 'GitProviderContract');
    if (!contrato) throw new Error('GitProviderContract não encontrada');
    return contrato.members
      .filter(ts.isMethodSignature)
      .map((m) => m.name.getText());
  };

  /**
   * Quem IMPLEMENTA o contrato não é consumidor dele — senão todo provider
   * "consumiria" as 12 operações e a trava não pegaria nada. Derivado do
   * código, e não de uma lista de caminhos, para que um provider novo
   * (Bitbucket e Generic são fase declarada) seja excluído sozinho.
   */
  const consumidores = (): { caminho: string; texto: string }[] =>
    arquivosTs(raizDoSrc)
      .map((caminho) => ({ caminho, texto: readFileSync(caminho, 'utf8') }))
      .filter(({ texto }) => !/implements\s+GitProviderContract/.test(texto));

  const operacoesSemConsumidor = (): string[] => {
    const arquivos = consumidores();
    return operacoesDoContrato().filter((operacao) => {
      const chamada = new RegExp(`\\.${operacao}\\s*\\(`);
      return !arquivos.some(({ texto }) => chamada.test(texto));
    });
  };

  it('toda operação sem consumidor está DECLARADA, com a fase que a consome', () => {
    expect(operacoesSemConsumidor().sort()).toEqual(
      Object.keys(SEM_CONSUMIDOR_AINDA).sort(),
    );
  });

  it('a declaração não apodrece: operação que já tem consumidor sai da lista', () => {
    const aindaSemConsumidor = new Set(operacoesSemConsumidor());
    const jaConsumidas = Object.keys(SEM_CONSUMIDOR_AINDA).filter(
      (operacao) => !aindaSemConsumidor.has(operacao),
    );
    expect(jaConsumidas).toEqual([]);
  });

  it('a exceção é estreita: a maioria das operações tem consumidor de verdade', () => {
    const total = operacoesDoContrato().length;
    expect(Object.keys(SEM_CONSUMIDOR_AINDA).length).toBeLessThan(total / 2);
  });
});
