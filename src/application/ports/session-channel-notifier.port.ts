/**
 * Avisa o canal `session:<id>` de que a api gravou um evento (AT-157, RN-579).
 *
 * O engine já avisa toda escrita que ELE faz pela api; esta porta cobre a
 * escrita que NÃO passa por ele (a decisão de um humano noutra aba, uma
 * transição de sessão, o chat direto da api). O aviso leva SÓ o tipo e o ator,
 * nunca o `payload`, e é sempre "melhor esforço": o canal é gatilho e o GET
 * continua sendo a fonte, então falhar em avisar nunca falha a escrita.
 */
export abstract class SessionChannelNotifier {
  /**
   * Chamar DENTRO da transação da escrita é seguro: a implementação só
   * dispara depois do commit do escopo mais externo, e descarta se ele
   * desfizer.
   */
  abstract eventAppended(
    sessionId: string,
    type: string,
    actorId: string | undefined,
  ): void;
}
