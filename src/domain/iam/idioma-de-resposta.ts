import type { UserLocale } from './user.entity';

/**
 * O idioma em que os agentes RESPONDEM a uma pessoa (RN-618, ADR 0177) — eixo
 * separado do idioma da INTERFACE (`users.locale`, RN-432), que continua
 * fechado a `pt-BR`/`en` e que nada aqui altera.
 *
 * Regra pura, sem I/O: a normalização de um código e a precedência entre as
 * quatro fontes. Quem LÊ as fontes é `ResolverIdiomaDaRespostaUseCase`.
 */

/**
 * O valor que a api mostra e aceita para "sem escolha explícita". No banco ele
 * é `NULL` (`users.response_language`), nunca esta string — ela existe só na
 * borda HTTP, para o contrato dizer o nome da coisa em vez de um `null` que
 * poderia ser lido como "não carregou".
 */
export const IDIOMA_AUTOMATICO = 'automatico' as const;

/**
 * Teto de caracteres de um código aceito. O RFC 5646 não fixa máximo, mas
 * recomenda que implementações suportem ao menos 35 — e nenhum idioma de
 * resposta real precisa de mais. É o que impede a coluna de virar depósito de
 * texto livre.
 */
export const TAMANHO_MAXIMO_DO_IDIOMA = 35;

// Só letras, dígitos e hífen: `Intl.getCanonicalLocales` aceita também `_`
// em algumas versões do ICU, e isso deixaria duas grafias do mesmo código
// passarem por caminhos diferentes.
const FORMA = /^[A-Za-z0-9-]+$/;

const nomesDeIdioma = new Intl.DisplayNames(['en'], {
  type: 'language',
  fallback: 'none',
});

/**
 * Normaliza um código BCP-47 para a forma CANÔNICA (`pt-br` → `pt-BR`,
 * `EN` → `en`), ou devolve `null` quando o valor não é um idioma aceitável.
 *
 * A lista é ABERTA (decisão do mantenedor, AT-168 resposta 2) mas não é texto
 * livre, e a régua tem três partes:
 * 1. a FORMA do BCP-47, por `Intl.getCanonicalLocales` — que lança
 *    `RangeError` para o que não é uma tag estruturalmente válida;
 * 2. a SUBTAG DE IDIOMA existe para o ICU do processo (`Intl.DisplayNames`
 *    com `fallback: 'none'`) — é o que recusa `zz` e `abc`, que têm a forma
 *    certa e não são idioma nenhum;
 * 3. nunca `und` ("indeterminado") nem tag de uso privado (`x-…`), que não
 *    dizem em que idioma responder.
 *
 * O preço declarado da parte 2: a lista de idiomas conhecidos é a do ICU do
 * Node que roda a api, então um código ISO 639-3 raro que o ICU não nomeia é
 * recusado. Nenhum idioma de resposta plausível está nesse caso.
 */
export function normalizarIdiomaBcp47(valor: string): string | null {
  const bruto = valor.trim();
  if (bruto.length === 0 || bruto.length > TAMANHO_MAXIMO_DO_IDIOMA) {
    return null;
  }
  if (!FORMA.test(bruto)) return null;

  let canonico: string;
  try {
    [canonico] = Intl.getCanonicalLocales(bruto);
  } catch {
    return null;
  }
  if (!canonico) return null;

  const idioma = canonico.split('-')[0].toLowerCase();
  if (idioma === 'und' || idioma === 'x') return null;
  if (nomesDeIdioma.of(idioma) === undefined) return null;
  return canonico;
}

/**
 * De onde veio o idioma efetivo — a tela o NOMEIA (RN-620), no molde da
 * RN-470: nunca um valor sem dizer de onde saiu.
 *
 * - `sessao`: a pessoa fixou um idioma NESTA sessão;
 * - `conta`: a escolha explícita da Conta;
 * - `detectado`: o detectado pelas mensagens da pessoa e CONFIRMADO por ela;
 * - `interface`: nenhum dos três — vale o idioma da interface.
 */
export type OrigemDoIdiomaDaResposta =
  'sessao' | 'conta' | 'detectado' | 'interface';

export interface FontesDoIdiomaDaResposta {
  /** `session_language_overrides.language` desta pessoa nesta sessão. */
  sessao: string | null;
  /** `users.response_language` — `null` é o automático. */
  conta: string | null;
  /**
   * `users.detected_language`, que só existe CONFIRMADO (CHECK
   * `users_idioma_detectado_so_confirmado`).
   */
  detectadoConfirmado: string | null;
  /** `users.locale` — `NOT NULL`, então a cadeia sempre termina num idioma. */
  interface: UserLocale;
}

export interface IdiomaDaRespostaResolvido {
  idioma: string;
  origem: OrigemDoIdiomaDaResposta;
}

/**
 * A precedência (RN-618), resolvida para UMA pessoa — nunca para "a sessão",
 * porque dois usuários na mesma sessão podem ter idiomas diferentes:
 *
 *   override da sessão > escolha da conta > detectado confirmado > interface
 *
 * O "pedido pontual" dentro de uma mensagem ("traduza para o inglês") NÃO é
 * degrau desta cadeia: quem o atende é o modelo, pela redação da orientação
 * (AT-081), e ele não muda preferência nenhuma.
 */
export function resolverIdiomaDaResposta(
  fontes: FontesDoIdiomaDaResposta,
): IdiomaDaRespostaResolvido {
  if (fontes.sessao) return { idioma: fontes.sessao, origem: 'sessao' };
  if (fontes.conta) return { idioma: fontes.conta, origem: 'conta' };
  if (fontes.detectadoConfirmado) {
    return { idioma: fontes.detectadoConfirmado, origem: 'detectado' };
  }
  return { idioma: fontes.interface, origem: 'interface' };
}
