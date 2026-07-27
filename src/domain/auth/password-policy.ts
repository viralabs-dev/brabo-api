import { normalizarEmail } from './email';

/**
 * Política mínima de senha (Fase 7a, item 2).
 *
 * ## Comprimento, não composição
 *
 * O mínimo é 12 caracteres e NÃO há exigência de maiúscula, dígito ou
 * símbolo. É a recomendação atual do NIST (SP 800-63B) e a razão é medida, não
 * estética: regra de composição empurra o usuário para `Senha@123`, que é
 * curta, previsível e está em qualquer wordlist — enquanto uma frase longa sem
 * símbolo nenhum é ordens de grandeza mais cara de quebrar. Exigir composição
 * reduz a entropia real ao concentrar as senhas num padrão conhecido.
 *
 * O teto de 1024 não é política: é proteção. argon2id copia a entrada antes de
 * derivar, então senha de megabytes vira custo de memória por requisição, numa
 * rota pública e sem autenticação.
 */
export const COMPRIMENTO_MINIMO = 12;
export const COMPRIMENTO_MAXIMO = 1024;

/**
 * Lista curta e deliberadamente NÃO exaustiva.
 *
 * Um dicionário de verdade (rockyou, HIBP) é a defesa real e não cabe em
 * constante no código — entra como backlog no ADR. Isto aqui pega o caso do
 * usuário que digita o óbvio, e o comentário existe para ninguém confundir as
 * duas coisas e achar que o problema está resolvido.
 */
export const PROIBIDAS = new Set([
  // Toda entrada precisa ter pelo menos COMPRIMENTO_MINIMO caracteres: a
  // checagem de tamanho roda ANTES desta, então uma entrada mais curta nunca
  // é alcançada e só dá a impressão de estar coberta. O teste
  // "nenhuma entrada é inalcançável" existe por isso.
  'senha1234567',
  'senhasenha12',
  '123456789012',
  'password1234',
  'qwertyuiop12',
  'brabo1234567',
  'administrador',
  'abcdefghijkl',
]);

export type FalhaDePolitica =
  'curta' | 'longa' | 'comum' | 'igual_ao_email' | 'so_repeticao';

export class PoliticaDeSenhaError extends Error {
  constructor(readonly falha: FalhaDePolitica) {
    super(mensagemDe(falha));
    this.name = 'PoliticaDeSenhaError';
  }
}

function mensagemDe(falha: FalhaDePolitica): string {
  switch (falha) {
    case 'curta':
      return `A senha precisa de pelo menos ${COMPRIMENTO_MINIMO} caracteres.`;
    case 'longa':
      return `A senha não pode passar de ${COMPRIMENTO_MAXIMO} caracteres.`;
    case 'comum':
      return 'Essa senha é fácil de adivinhar. Escolha outra.';
    case 'igual_ao_email':
      return 'A senha não pode ser o seu e-mail.';
    case 'so_repeticao':
      return 'A senha não pode ser um único caractere repetido.';
  }
}

/** Devolve a primeira falha, ou `null` quando a senha passa. */
export function avaliarSenha(
  senha: string,
  email: string,
): FalhaDePolitica | null {
  if (senha.length < COMPRIMENTO_MINIMO) return 'curta';
  if (senha.length > COMPRIMENTO_MAXIMO) return 'longa';

  const normalizada = senha.normalize('NFKC').toLowerCase();

  // `aaaaaaaaaaaa` tem 12 caracteres e passaria no comprimento. O conjunto de
  // um caractere só é o buraco mais óbvio de uma regra que só conta tamanho.
  if (new Set(normalizada).size === 1) return 'so_repeticao';

  if (PROIBIDAS.has(normalizada)) return 'comum';

  // Compara com o e-mail inteiro E com a parte local: `fulano@brabo.dev` e
  // `fulano` são igualmente adivinháveis por quem já conhece o endereço.
  const emailNormalizado = normalizarEmail(email);
  const parteLocal = emailNormalizado.split('@')[0];
  if (normalizada === emailNormalizado) return 'igual_ao_email';
  if (parteLocal.length >= COMPRIMENTO_MINIMO && normalizada === parteLocal) {
    return 'igual_ao_email';
  }

  return null;
}

/** Lança `PoliticaDeSenhaError` quando a senha não passa. */
export function exigirSenhaValida(senha: string, email: string): void {
  const falha = avaliarSenha(senha, email);
  if (falha) throw new PoliticaDeSenhaError(falha);
}
