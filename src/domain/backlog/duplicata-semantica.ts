/**
 * Duplicata SEMÂNTICA de história e de regra de negócio (RN-681, ADR 0198,
 * AT-171) — a metade que a [RN-080]/[RN-081] declaravam fora de alcance:
 * "Endpoint público de saudação determinística" e "Endpoint GET /hello
 * público que devolve saudação imediata" (o par do achado R) não têm nada
 * mecânico em comum, e passavam.
 *
 * O mecanismo é a decisão do dono (01/10): embedding do título com LIMIAR,
 * que só AVISA. A recusa continua sendo da duplicata EXATA (RN-080/081) e
 * nada aqui recusa: o aviso volta ao agente como resultado de ferramenta e
 * fica no log, e quem julga é quem lê.
 *
 * Puro de propósito — sem provider, sem banco: é o que deixa a calibração do
 * limiar ser provada com vetores GRAVADOS em vez de um daemon vivo.
 */

/**
 * O limiar de similaridade de cosseno a partir do qual o aviso sai.
 *
 * **PONTO DE PARTIDA, NÃO CALIBRADO** — como os pesos da busca híbrida do
 * ADR 0080. A decisão do dono pedia calibrar com o par do achado R e com
 * pares que NÃO são duplicata, sobre vetores reais do `nomic-embed-text`; o
 * ambiente em que este número nasceu não alcançava nem o registry do Ollama
 * nem o Hugging Face, então os vetores não puderam ser gravados (ADR 0198,
 * "O que não foi medido"). O número é 0,80 porque, num modelo de embedding de
 * frase, paráfrases curtas costumam cair acima dele e assuntos vizinhos
 * abaixo — conhecimento geral, não medição. A prova que o substitui é
 * `limiar-de-duplicata.calibracao.spec.ts`, que roda sozinha assim que
 * `test/fixtures/duplicata-semantica/vetores.json` existir.
 *
 * Errar para cima custa um aviso que não sai (o estado de antes); errar para
 * baixo custa um aviso a mais — e aviso não bloqueia nada. É por isso que um
 * número provisório é aceitável AQUI e não seria numa recusa.
 */
export const LIMIAR_DE_DUPLICATA_SEMANTICA = 0.8;

/**
 * Quantas existentes entram na comparação, no máximo: as MAIS RECENTES. Sem
 * teto, o custo de emitir a centésima regra seria cem vezes o da primeira —
 * cada emissão vetoriza todas as existentes de novo, porque nenhuma tem
 * vetor guardado (ADR 0198). Quando corta, o resultado DIZ quantas ficaram
 * de fora (RN-180).
 */
export const TETO_DE_COMPARACOES_DE_DUPLICATA = 100;

/**
 * Teto de RELÓGIO da checagem inteira, em ms. O timeout do provider é o do
 * Ollama (até 300 s na instalação), e a checagem roda no caminho de uma
 * ferramenta do agente: um daemon lento seguraria o turno. Fica ABAIXO dos
 * 15 s do `Req` do engine que chama a rota — senão a emissão estouraria lá
 * antes de a checagem desistir aqui.
 */
export const TETO_DE_TEMPO_DA_CHECAGEM_MS = 10_000;

export type TipoDeItem = 'story' | 'business_rule';

export interface ItemComVetor {
  id: string;
  title: string;
  vetor: readonly number[];
}

export interface Parecido {
  id: string;
  title: string;
  similaridade: number;
}

/** Cosseno entre dois vetores do MESMO modelo. Dimensões diferentes lançam. */
export function similaridadeCosseno(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length) {
    throw new Error(
      `vetores de dimensões diferentes (${a.length} × ${b.length}) não se comparam`,
    );
  }
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (let i = 0; i < a.length; i++) {
    produto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

/** A existente mais próxima do vetor novo, com a similaridade — ou `null` sem existentes. */
export function maisParecida(
  vetorNovo: readonly number[],
  existentes: readonly ItemComVetor[],
): Parecido | null {
  let melhor: Parecido | null = null;
  for (const item of existentes) {
    const similaridade = similaridadeCosseno(vetorNovo, item.vetor);
    if (!melhor || similaridade > melhor.similaridade) {
      melhor = { id: item.id, title: item.title, similaridade };
    }
  }
  return melhor;
}

/** Igual ao limiar AVISA: o número é "a partir de", não "acima de". */
export function ehDuplicataSemantica(
  similaridade: number,
  limiar: number = LIMIAR_DE_DUPLICATA_SEMANTICA,
): boolean {
  return similaridade >= limiar;
}
