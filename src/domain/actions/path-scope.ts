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
  const r = semBarraFinal(posix.normalize(raiz));
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Tira as barras finais SEM regex.
 *
 * Era `.replace(/\/+$/, '')`, e o CodeQL apontou ReDoS polinomial
 * (`js/polynomial-redos`, HIGH): `\/+$` obriga o motor a tentar cada posição
 * inicial e varrer até o fim, degradando em O(n²) numa string cheia de
 * barras. A raiz vem de configuração hoje, mas a função é exportada e o
 * `caminho` deriva de comando de AGENTE — assumir que o dado é confiável
 * seria apostar no chamador de amanhã.
 *
 * O laço faz o mesmo em O(n) e é EQUIVALENTE ao regex, inclusive no caso
 * degenerado: a raiz `/` vira string vazia nos dois, e é isso que faz
 * `startsWith('/')` continuar valendo para todo caminho absoluto. Preservar
 * a `/` mudaria a semântica de carona, e correção de segurança não muda
 * comportamento sem querer.
 */
function semBarraFinal(caminho: string): string {
  let fim = caminho.length;
  while (fim > 0 && caminho[fim - 1] === '/') fim--;
  return caminho.slice(0, fim);
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
/**
 * Dispositivos que NÃO são caminho de usuário.
 *
 * `2>/dev/null` é idioma, não acesso a arquivo: descarta saída, não lê nem
 * escreve dado de ninguém. Tratá-lo como caminho fora do escopo fazia o teto
 * rebaixar qualquer comando que silenciasse erro esperado — e modelos fazem
 * isso o tempo todo (achado AC da FASE 13b).
 *
 * A lista é curta de propósito e NÃO é `/dev` inteiro: `/dev/sda` é disco,
 * `/dev/mem` é memória física. O que entra aqui são os fluxos padrão e o
 * buraco negro, cujo conteúdo não pertence a ninguém.
 */
const DISPOSITIVOS_NEUTROS = new Set([
  '/dev/null',
  '/dev/stdin',
  '/dev/stdout',
  '/dev/stderr',
]);

export function tokensDeCaminho(segmentos: string[][]): string[] {
  return segmentos
    .flat()
    .filter((t) => !DISPOSITIVOS_NEUTROS.has(t))
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
  raiz: string | readonly string[],
): boolean {
  const raizes = typeof raiz === 'string' ? [raiz] : raiz;
  const dentro = (caminho: string) =>
    raizes.some((r) => dentroDoEscopo(caminho, r));
  // Sem `cwd` o executor roda no workspace compartilhado do projeto, que é a
  // PRIMEIRA raiz — dentro do escopo por construção.
  const base = cwd ?? raizes[0];
  if (base === undefined || !dentro(base)) return false;

  return tokensDeCaminho(segmentos).every((token) =>
    dentro(normalizarCaminho(token, base)),
  );
}

/**
 * O ponto de montagem do container do projeto — CÓPIA de `PONTO_DE_MONTAGEM`
 * (`packages/docker-port/src/docker-port.ts`), porque a api não consome a
 * porta de Docker (`api-nao-consome-docker-port.spec.ts`). A cópia é travada
 * por teste contra a fonte (`path-scope.spec.ts`), como a do engine
 * (`@ponto_de_montagem` em `terminal_executor.ex`).
 */
export const PONTO_DE_MONTAGEM_DO_CONTAINER = '/work';

/** O `/tmp` do PRÓPRIO container — não o do host (RN-669). */
export const TMP_DO_CONTAINER = '/tmp';

/**
 * O `cwd` de HOST traduzido para dentro do container — a MESMA tradução que o
 * engine faz antes de chamar o broker (`cwd_para_container/2` em
 * `apps/engine/lib/engine/actions/terminal_executor.ex`): a raiz do projeto
 * vira `/work`, o que está sob ela (os `.worktrees` dos dev agents inclusive)
 * vira `/work/...`, e o que está FORA dela segue como veio — o engine também
 * não adivinha, e o broker recusa o que não estiver em `/work`.
 *
 * Em `mounted` a tradução é bijetiva: o bind-mount é a identidade da pasta do
 * projeto (ADR 0141/0144), e `/work/x` é exatamente `<pasta>/x`.
 */
export function cwdNoContainer(cwd: string, raizNoHost: string): string {
  const c = semBarraFinal(normalizarCaminho(cwd)) || '/';
  const r = semBarraFinal(posix.normalize(raizNoHost));
  if (c === r) return PONTO_DE_MONTAGEM_DO_CONTAINER;
  if (r.length > 0 && c.startsWith(`${r}/`)) {
    return PONTO_DE_MONTAGEM_DO_CONTAINER + c.slice(r.length);
  }
  return c;
}

/**
 * O escopo de um comando que roda DENTRO do container do projeto (RN-669, ADR
 * 0189, AT-258). Raízes: `/work` — o ponto de montagem, onde moram a pasta do
 * projeto e os `.worktrees` dos dev agents — e o `/tmp` do container. O `cwd`
 * chega como caminho do HOST e é traduzido antes (`cwdNoContainer`); sem `cwd`
 * o comando roda em `/work`.
 *
 * Por que `/tmp` entra aqui e não no host: dentro do container ele é do
 * container, descartável e de mais ninguém; no host é compartilhado com tudo
 * o que roda na máquina — inclusive o próprio Brabo.
 */
export function comandoNoEscopoDoContainer(
  segmentos: string[][],
  cwd: string | undefined,
  raizNoHost: string,
): boolean {
  const base =
    cwd === undefined
      ? PONTO_DE_MONTAGEM_DO_CONTAINER
      : cwdNoContainer(cwd, raizNoHost);
  return comandoNoEscopo(segmentos, base, [
    PONTO_DE_MONTAGEM_DO_CONTAINER,
    TMP_DO_CONTAINER,
  ]);
}
