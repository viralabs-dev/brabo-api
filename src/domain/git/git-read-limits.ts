/**
 * Tetos das duas operações de LEITURA do `GitProviderContract` — `listTree` e
 * `getPullRequestDiff`, a 11ª e a 12ª (FASE 26, aba Code).
 *
 * ## Por que aqui, e não em `packages/shared` junto dos tipos
 *
 * O shared é 100% tipo por invariante travado
 * (`apps/api/test/packages-shared-so-tipos.spec.ts`): um `export const` lá
 * sobrevive ao `tsc`, e o `main` do pacote aponta pro `.ts` cru, o que mata o
 * boot da api em produção. A regra que aquele teste escreve é "a lista em
 * runtime mora no CONSUMIDOR", como `domain/llm/llm-provider-names.ts` já
 * fazia. Estes números são valores, então moram aqui.
 *
 * ## Por que existir
 *
 * O item 34 da FASE 26: "buscar em repositório grande GASTA: teto e cache,
 * senão a aba vira amplificador de tráfego". O teto é o que impede uma
 * árvore de dezenas de milhares de entradas, ou uma PR de mil arquivos, de
 * virar uma resposta que ninguém consegue renderizar e que custou N chamadas
 * à API do provider para montar.
 *
 * Cortar é visível, nunca silencioso: quem corta marca `truncated: true`, que
 * é parte do contrato justamente para a tela poder dizer que há mais.
 */

/** Entradas por NÍVEL da árvore. */
export const GIT_TREE_ENTRY_LIMIT = 1000;

/** Arquivos por diff de PR. */
export const GIT_DIFF_FILE_LIMIT = 300;

// ---------------------------------------------------------------------------
// Tetos da SUPERFÍCIE HTTP de leitura (FASE 26b)
//
// Os dois de cima são do CONTRATO — eles limitam o que um provider devolve numa
// chamada. Os de baixo limitam quantas CHAMADAS a superfície faz por requisição
// do cliente, e é outra coisa: `listTree` é barato uma vez e caro mil vezes.
//
// A busca é o caso que obriga a distinção. Ela não é operação do contrato:
// nenhum dos três providers a tem, e inventá-la traria code search da
// plataforma para dentro do contrato normalizado. Então ela é COMPOSTA sobre
// `listTree` + `getFileContent` — e composição sem teto é o amplificador de
// tráfego que a fase proíbe pelo nome (item 34), a mesma família dos
// 3.824 req/min do dashboard na PÓS-FASE 15.
// ---------------------------------------------------------------------------

/**
 * Diretórios que UMA busca percorre — cada um custa uma chamada `listTree`.
 *
 * O corte é por número de chamadas e não por profundidade: uma árvore rasa e
 * larga (mil pastas na raiz) custa o mesmo que uma funda e estreita, e só a
 * contagem de chamadas enxerga as duas.
 */
export const GIT_SEARCH_DIR_LIMIT = 60;

/** Arquivos que UMA busca abre — cada um custa uma chamada `getFileContent`. */
export const GIT_SEARCH_FILE_LIMIT = 200;

/** Linhas casadas devolvidas por busca. */
export const GIT_SEARCH_MATCH_LIMIT = 100;

/**
 * Bytes de um arquivo lido pela aba.
 *
 * Vale para a rota de blob (que corta e marca `truncated`) e para a busca (que
 * PULA o arquivo grande em vez de cortá-lo — casar metade de um arquivo daria
 * um resultado que muda conforme o teto, e isso é pior que não casar).
 */
export const GIT_BLOB_MAX_BYTES = 512 * 1024;

/**
 * Entradas vivas no cache de leitura, e por quanto tempo.
 *
 * Curto de propósito: a aba Code lê uma branch VIVA, e um TTL longo mostraria
 * código que já mudou. 30s cobre o padrão real de uso — navegar a árvore,
 * abrir três arquivos, buscar — sem que a tela minta sobre o repositório.
 */
export const GIT_READ_CACHE_MAX_ENTRIES = 500;
export const GIT_READ_CACHE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Tetos das TRÊS operações novas do contrato (FASE 26b — blame, PRs
// navegáveis, branch rica). Moram aqui pelo MESMO motivo dos de cima: são
// valores, não tipo, e `packages/shared` é 100% tipo por invariante travado.
// ---------------------------------------------------------------------------

/**
 * Linhas anotadas por chamada de `blame`.
 *
 * Um arquivo de uma linha só (minificado) já é coberto por
 * `GIT_BLOB_MAX_BYTES` na rota de conteúdo, mas `blame` lê o arquivo INTEIRO
 * do provider antes de decidir — o teto de linhas é o que impede um arquivo
 * de texto genuinamente enorme (log, dataset) de virar uma resposta de
 * dezenas de milhares de entradas.
 */
export const GIT_BLAME_LINE_LIMIT = 2000;

/**
 * PRs/MRs devolvidas por chamada de `listPullRequests`.
 *
 * UMA página, sem paginação de seguimento — a lista é pra navegação humana
 * na aba Code, não pra sincronizar todo o histórico de PRs do repositório.
 */
export const GIT_PR_LIST_LIMIT = 100;

/**
 * Branches enriquecidas por chamada de `listBranchesDetailed`.
 *
 * Cada uma custa ao menos UMA chamada extra ao provider (comparação
 * ahead/behind) — duas no GitLab, que não tem um endpoint que devolva os
 * dois lados de uma comparação como o GitHub. Sem teto, um repositório com
 * centenas de branches viraria centenas de chamadas por abertura do
 * dropdown — o mesmo amplificador de tráfego que a busca (item 34 da FASE
 * 26) já tinha proibido pelo nome.
 */
export const GIT_BRANCH_DETAIL_LIMIT = 30;
