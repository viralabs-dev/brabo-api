/** AT-1038 (RN-1549): marcador que a saída do terminal usa no lugar do segredo. O engine recusa gravá-lo em arquivo. */
export const MARCADOR_OCULTO = '[oculto]';

const NOME_DE_SEGREDO = /PASS|PWD|SECRET|TOKEN|KEY|CREDENTIAL|PRIVATE/i;
const TAMANHO_MINIMO = 8;
const SENHA_EM_URL = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+@/gi;

/**
 * Esconde a senha de toda URL e o valor das variáveis declaradas cujo nome tem
 * cara de segredo e que têm 8 caracteres ou mais.
 * shortcut: senha curta SOLTA (fora de URL) ou de variável de nome comum não é
 * coberta; evoluir se aparecer segredo curto real fora de URL.
 */
export function mascararSaida(
  texto: string,
  variaveis: ReadonlyArray<Readonly<Record<string, string>>> = [],
): string {
  let saida = texto.replace(SENHA_EM_URL, `$1${MARCADOR_OCULTO}@`);
  const valores = new Set<string>();
  for (const env of variaveis) {
    for (const [nome, valor] of Object.entries(env)) {
      if (NOME_DE_SEGREDO.test(nome) && valor.length >= TAMANHO_MINIMO) {
        valores.add(valor);
      }
    }
  }
  // O maior primeiro: um valor contido em outro não sobra pela metade.
  for (const v of [...valores].sort((a, b) => b.length - a.length)) {
    saida = saida.split(v).join(MARCADOR_OCULTO);
  }
  return saida;
}
