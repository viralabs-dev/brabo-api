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
