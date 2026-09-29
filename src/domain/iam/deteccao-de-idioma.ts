import type { IdiomaDaRespostaResolvido } from './idioma-de-resposta';
import type { Idioma } from './heuristica-de-idioma';

/**
 * Quando a detecção de idioma PERGUNTA (AT-163, RN-624) — regra pura, sem I/O.
 *
 * A decisão do mantenedor (AT-168 respostas 4, 6 e 7) é que a detecção NUNCA
 * troca a preferência sozinha: ela pergunta ("Detectamos que você escreve em
 * X — usar X nas respostas?"), e só o CONFIRMADO vira `users.detected_language`.
 * Esta função decide se há pergunta a fazer; quem detecta é a heurística
 * (`heuristica-de-idioma.ts`) e quem lê as mensagens é o caso de uso.
 */

/** A subtag de idioma de um código BCP-47 canônico (`pt-BR` → `pt`). */
export function subtagDeIdioma(codigo: string): string {
  return codigo.split('-')[0].toLowerCase();
}

export interface EntradaDaPergunta {
  /**
   * O idioma que as últimas avaliações da amostra apontam JUNTAS
   * (`idiomaConcordante`), ou `null` — indeterminado nunca pergunta.
   */
  detectado: Idioma | null;
  /** O efetivo de hoje para esta pessoa, com a origem (RN-618). */
  efetivo: IdiomaDaRespostaResolvido;
  /** Os idiomas que ela já recusou nesta mesma pergunta. */
  recusados: readonly string[];
}

/**
 * O idioma a perguntar, ou `null` quando não há pergunta. Não pergunta quando:
 *
 * 1. a detecção não concorda (`null`) — texto curto, código, log, misto;
 * 2. o efetivo vem de uma escolha EXPLÍCITA — override da sessão ou escolha da
 *    Conta. Confirmar gravaria `detected_language`, que fica ABAIXO dessas
 *    duas na precedência: a resposta não mudaria, e a pergunta prometeria o
 *    que não entrega. Quem escolheu explicitamente troca onde escolheu;
 * 3. o detectado já é o efetivo — compara a SUBTAG (`pt` × `pt-BR`), porque
 *    a heurística só sabe a língua, nunca a variante;
 * 4. a pessoa já recusou ESTE idioma — a recusa vale até ela confirmá-lo.
 */
export function idiomaAPerguntar(entrada: EntradaDaPergunta): Idioma | null {
  const { detectado, efetivo, recusados } = entrada;
  if (detectado === null) return null;
  if (efetivo.origem === 'sessao' || efetivo.origem === 'conta') return null;
  if (subtagDeIdioma(efetivo.idioma) === detectado) return null;
  if (recusados.some((r) => subtagDeIdioma(r) === detectado)) return null;
  return detectado;
}
