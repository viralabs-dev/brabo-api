import { posix } from 'node:path';

/**
 * Escopo de caminho da política de terminal (ADR 0055).
 *
 * O problema que isto resolve, medido na execução do `hello-limpo`: dentro do
 * container que executa as ações, `/workspace` é o monorepo do PRÓPRIO Brabo, e
 * `/data/project-workspaces/*` alcança o worktree de outros projetos. Como o
 * casamento de `permissions.json` é por VERBO, `cat` liberado libera
 * `cat /workspace/apps/engine/lib/engine/actions/git_executor.ex` — o executor
 * de git da plataforma — exatamente como o dev agent propôs.
 *
 * A normalização aqui é LÉXICA, não `realpath`. Isto é deliberado:
 * `decide()` é puro por contrato ("zero IO", ver decide.ts), e resolver link
 * simbólico exigiria tocar o sistema de arquivos dentro do domínio. O léxico
 * mata o vetor que importa — `<raiz>/../..` começa com a raiz e sai dela — e
 * deixa um em aberto: um symlink DENTRO do projeto apontando para fora não é
 * detectado. Fechar esse é isolamento (montagem por projeto), não política, e
 * está registrado como a outra metade do achado U.
 */

/** Normaliza sem tocar o disco. `..` é resolvido; caminho relativo é ancorado. */
export function normalizarCaminho(caminho: string, base?: string): string {
  const absoluto = caminho.startsWith('/')
    ? caminho
    : posix.join(base ?? '/', caminho);
  return posix.normalize(absoluto);
}

/**
 * `caminho` está sob `raiz`?
 *
 * A barra final não é detalhe: sem ela `/data/ws/abc` casaria o prefixo de
 * `/data/ws/abcdef`, que é outro projeto. A própria raiz conta como dentro.
 */
export function dentroDoEscopo(caminho: string, raiz: string): boolean {
  const c = normalizarCaminho(caminho);
  const r = posix.normalize(raiz).replace(/\/+$/, '');
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Tokens do comando que precisam ser verificados contra o escopo.
 *
 * Dois casos, e só eles:
 *
 * - **absoluto** (`/workspace/...`): inequivocamente um caminho, e o único
 *   jeito de apontar para fora sem passar pelo `cwd`;
 * - **contém `..`**: relativo que pode escapar quando ancorado no `cwd`.
 *
 * Relativo sem `..` NÃO entra: ele resolve sob o `cwd`, que já foi verificado.
 * Verificar todo token seria pior que inútil — `-maxdepth`, `4`, `*.ex` e
 * `HEAD` não são caminhos, e tratá-los como tal reprovaria comando legítimo
 * sem ganhar segurança nenhuma.
 */
export function tokensDeCaminho(segmentos: string[][]): string[] {
  return segmentos
    .flat()
    .filter((t) => t.startsWith('/') || t.split('/').includes('..'));
}

/**
 * O comando INTEIRO está dentro do escopo?
 *
 * Exige as duas coisas: o diretório de execução dentro da raiz, e todo token
 * de caminho dentro da raiz. Um único caminho de fora reprova o comando todo —
 * é o mesmo princípio do comando composto em `decide()`, onde um segmento sem
 * regra reprova o conjunto.
 */
export function comandoNoEscopo(
  segmentos: string[][],
  cwd: string | undefined,
  raiz: string,
): boolean {
  // Sem `cwd` o executor roda no workspace compartilhado do projeto, que é a
  // própria raiz — dentro do escopo por construção.
  const base = cwd ?? raiz;
  if (!dentroDoEscopo(base, raiz)) return false;

  return tokensDeCaminho(segmentos).every((token) =>
    dentroDoEscopo(normalizarCaminho(token, base), raiz),
  );
}
