/**
 * O vocabulário da TELEMETRIA de busca do RAG (RN-479/480/481).
 *
 * ## Por que esta camada existe
 *
 * `rag-search-limits.ts` declara, no próprio comentário, que os quatro
 * números da busca híbrida (candidatos, limiar e os dois pesos) **não vêm de
 * calibração com dado real**. Não vinham porque não havia como: a busca não
 * deixava rastro nenhum — zero eventos, zero linha de tabela. Calibrar sem
 * medir seria trocar um chute por outro.
 *
 * Este arquivo é o vocabulário da medição que destrava a calibração. Ele NÃO
 * calibra nada e não deve: mudar os pesos aqui destruiria a linha de base que
 * a telemetria existe para criar.
 *
 * ## Os pesos vão CONGELADOS na linha
 *
 * `pesosVigentes()` copia os valores do momento da busca para dentro do
 * registro. É a mesma disciplina do preço congelado no metering (ADR 0042) e
 * da `image_version` em `project_containers`: sem a cópia, mudar
 * `RAG_SEARCH_WEIGHT_VECTOR` amanhã faria toda a medição de ontem passar a
 * significar outra coisa, calada — e a comparação "antes/depois da
 * calibração", que é a única pergunta que a telemetria existe para responder,
 * ficaria impossível de fazer.
 */
import {
  RAG_SEARCH_SCORE_THRESHOLD,
  RAG_SEARCH_WEIGHT_LEXICAL,
  RAG_SEARCH_WEIGHT_VECTOR,
} from './rag-search-limits';

/**
 * Um trecho devolvido por UMA busca, como ele foi devolvido.
 *
 * `rank` é a posição (1-based) na lista que o usuário/agente viu. É ele —
 * cruzado com o voto de `rag_feedback` — que separa "o índice está pobre" de
 * "os PESOS estão errados": um índice pobre não devolve o trecho certo em
 * posição nenhuma; pesos errados devolvem o trecho certo em rank 7.
 */
export interface RagSearchHitTelemetry {
  chunkId: string;
  score: number;
  vectorScore: number | null;
  lexicalScore: number | null;
  rank: number;
}

/** Os pesos e o limiar que ESTA busca usou — nunca os de hoje, os dela. */
export interface RagSearchWeights {
  vector: number;
  lexical: number;
  threshold: number;
}

/**
 * Cópia dos pesos vigentes AGORA, para congelar na linha da busca.
 *
 * Função e não constante exportada de propósito: uma constante compartilhada
 * seria o MESMO objeto em toda linha do JSONB em memória, e um `Object.freeze`
 * esquecido em qualquer chamador viraria mutação retroativa de tudo.
 */
export function pesosVigentes(): RagSearchWeights {
  return {
    vector: RAG_SEARCH_WEIGHT_VECTOR,
    lexical: RAG_SEARCH_WEIGHT_LEXICAL,
    threshold: RAG_SEARCH_SCORE_THRESHOLD,
  };
}

// Os DOIS tipos de evento de sessão da telemetria são `rag.search` e
// `rag.feedback` (RN-481), e eles são escritos por EXTENSO nos dois pontos de
// emissão — `hybrid-search.use-case.ts` e `record-rag-feedback.use-case.ts` —,
// não por constante daqui. Não é descuido: o inventário de
// `docs/reference/events.md` é GERADO por grep de `type: '<x>.<y>'` sobre o
// código da api (`scripts/docs/generate.mjs`), e um tipo escondido atrás de
// constante fica invisível para ele — a doc passaria verde sobre uma lista
// incompleta. É a mesma forma de `execution.activated`
// (`activate-execution.use-case.ts`).
//
// Eles são NARRAÇÃO da timeline, nunca a fonte da medição, e só existem quando
// há sessão — ou seja, no caminho do AGENTE. A busca vinda da aba é de PROJETO
// e não tem sessão nenhuma (`session_events.session_id` é `NOT NULL`), então
// medir pelo evento perderia exatamente as buscas em que um humano olhou os
// scores e julgou. Quem mede é `rag_searches`/`rag_feedback`.

/**
 * O julgamento humano ou do agente sobre UM trecho de UMA busca.
 *
 * Dois valores e não uma nota de 1 a 5: o que a medição precisa saber é se o
 * trecho respondia a pergunta, e uma escala fina convida a diferenças de
 * régua entre quem vota que nenhuma agregação recupera depois.
 */
export const RAG_VERDICTS = ['util', 'irrelevante'] as const;

export type RagVerdict = (typeof RAG_VERDICTS)[number];

export function isRagVerdict(valor: unknown): valor is RagVerdict {
  return (
    typeof valor === 'string' &&
    (RAG_VERDICTS as readonly string[]).includes(valor)
  );
}
