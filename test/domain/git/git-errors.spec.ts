import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * A contagem de operações no cabeçalho de `git-errors.ts` é um FATO, e fato em
 * comentário apodrece.
 *
 * O achado #7 do primeiro dogfooding é exatamente isso: o arquivo dizia "8
 * operações" enquanto o contrato já tinha 10 — `getFileContent` (bootstrap
 * idempotente) e `commentOnPullRequest` (gates de PR, Fase 4a) entraram e o
 * comentário ficou. Ninguém tinha como desconfiar, porque nada comparava as
 * duas pontas.
 *
 * Este teste compara. Ele lê o número escrito no comentário e as operações
 * realmente declaradas em `GitProviderContract`, e reprova quando divergem —
 * então uma 11ª operação quebra aqui, no passo mais barato, em vez de virar
 * drift silencioso de novo.
 */
describe('cabeçalho de git-errors.ts × GitProviderContract', () => {
  const raizDoRepo = join(__dirname, '../../../../..');

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

    if (!contrato) throw new Error('GitProviderContract não encontrada no shared');

    // Só MÉTODOS contam como operação: `name` e `capabilities` são
    // propriedades do provider, não coisas que ele faz.
    return contrato.members
      .filter(ts.isMethodSignature)
      .map((m) => m.name.getText());
  };

  const contagemNoComentario = (): number => {
    const texto = readFileSync(
      join(raizDoRepo, 'apps/api/src/domain/git/git-errors.ts'),
      'utf8',
    );
    const achado = /Erros normalizados das (\d+) operações do GitProviderContract/.exec(
      texto,
    );

    if (!achado) throw new Error('cabeçalho de git-errors.ts mudou de forma');

    return Number(achado[1]);
  };

  it('o contrato tem as 15 operações que o cabeçalho afirma', () => {
    expect(operacoesDoContrato()).toEqual([
      'createRepo',
      'getRepo',
      'createBranch',
      'protectBranch',
      'commitFiles',
      'listBranches',
      'openPullRequest',
      'mergePullRequest',
      'getFileContent',
      'commentOnPullRequest',
      'listTree',
      'getPullRequestDiff',
      'blame',
      'listPullRequests',
      'listBranchesDetailed',
    ]);
  });

  it('o número no comentário é o número real de operações', () => {
    expect(contagemNoComentario()).toBe(operacoesDoContrato().length);
  });
});
