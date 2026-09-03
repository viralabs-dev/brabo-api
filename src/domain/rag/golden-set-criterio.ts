import type { ChunkOrigin } from './rag-citation';

/**
 * O critério de acerto do golden-set de acurácia do RAG (RN-490, ADR 0132) —
 * o equivalente, para busca, do `passou?` do golden-set do QA de Automação
 * (ADR 0123).
 *
 * Puro e sem IO, pelo mesmo motivo de `gate-registry.ts`: a decisão de "isto
 * bateu" não deveria depender de como o resultado chegou (script TS, teste
 * ExUnit, ou uma chamada solta pra depuração).
 *
 * ## Por que TOP-K, e não só a primeira posição
 *
 * Hit esperado é o **caminho do arquivo**, nunca o chunk exato — a mesma
 * régua frouxa do ADR 0123, adaptada: o chunking (1200/150) muda, e travar no
 * chunk quebraria o golden-set a cada ajuste de chunking, que é justamente o
 * parâmetro que ADR 0080 declara chute inicial e que este golden-set existe
 * para poder revisar sem reescrever os casos.
 *
 * TOP-K (não só rank 1) porque é assim que o produto realmente usa o
 * resultado: o Chat RAG cita VÁRIOS trechos ao lado de uma resposta
 * (`RagCitationCard`, plural), não só o primeiro. Um golden-set que exigisse
 * rank 1 mediria uma pergunta que a UI não faz — "isto é o MELHOR resultado
 * possível", quando a pergunta real é "isto está entre os que a pessoa vê".
 * `GOLDEN_SET_RAG_TOP_K = 5` não é arbitrário: é o teto de resultado que o
 * seed do golden-set pede à busca (ver `seed-golden-set-rag.ts`), e não o
 * `RAG_SEARCH_RESULT_LIMIT` (10) que a rota real usa — um golden-set que
 * pedisse 10 e medisse contra 10 estaria testando um k mais folgado que o
 * que a maioria das buscas de verdade usa (o painel do Chat RAG não rola
 * para ver os 10).
 */
export const GOLDEN_SET_RAG_TOP_K = 5;

export interface GoldenSetHit {
  origin: ChunkOrigin;
}

/**
 * `true` quando `expectedPath` aparece como a origem de algum hit dentro dos
 * primeiros `topK` — comparando o CAMINHO inteiro, nunca por `includes`
 * (dois ADRs numerados sequencialmente têm prefixo em comum).
 */
export function acertouCaminhoEsperado(
  hits: readonly GoldenSetHit[],
  expectedPath: string,
  topK: number = GOLDEN_SET_RAG_TOP_K,
): boolean {
  return hits
    .slice(0, topK)
    .some(
      (hit) =>
        hit.origin.kind === 'file' && hit.origin.sourcePath === expectedPath,
    );
}

/** A primeira posição (1-based) em que `expectedPath` aparece, ou `null`. */
export function rankDoCaminhoEsperado(
  hits: readonly GoldenSetHit[],
  expectedPath: string,
): number | null {
  const indice = hits.findIndex(
    (hit) =>
      hit.origin.kind === 'file' && hit.origin.sourcePath === expectedPath,
  );
  return indice === -1 ? null : indice + 1;
}
