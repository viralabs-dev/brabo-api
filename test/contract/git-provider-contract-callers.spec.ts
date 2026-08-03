import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

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
