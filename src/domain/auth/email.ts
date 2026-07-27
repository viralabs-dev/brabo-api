/**
 * Normalização única de e-mail (Fase 7a).
 *
 * Mora no domínio porque TRÊS lugares dependem de concordarem exatamente: a
 * busca da credencial, o índice único `lower(email)` no banco e a chave do
 * balde de lockout. Se dois deles normalizarem diferente, o efeito não é um
 * bug visível — é uma conta que o dono não consegue acessar, ou um lockout que
 * se contorna trocando a caixa de uma letra.
 *
 * NFKC antes do lowercase: sem isso, duas formas de composição Unicode do
 * mesmo endereço geram chaves diferentes, e quem souber disso pula o lockout.
 */
export function normalizarEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}
