import type { UserContextFact } from './graph-types';

/**
 * O texto que leva os FATOS do perfil de quem escreveu a mensagem ao agente
 * que a responde (RN-680, ADR 0196) — hipóteses do Psicólogo que a PRÓPRIA
 * pessoa aceitou neste projeto.
 *
 * Contido como toda leitura de agente (ADR 0060): no máximo
 * `FATOS_NO_CONTEXTO` fatos (o teto vem da leitura, `QueryUserContextUseCase`),
 * cada campo cortado em `TETO_POR_CAMPO` caracteres, e o recorte DITO quando
 * há mais fatos do que os que vão (RN-180). O engine o acrescenta como
 * mensagem de sistema EFÊMERA no turno do autor (`Engine.Harness.PerfilDoAutor`)
 * e tem o próprio teto em caracteres, o MESMO `TETO_DO_TEXTO` — o texto
 * montado aqui é cortado nele antes de sair, então o corte do engine é só a
 * segunda barreira.
 *
 * Sem fato nenhum, `null`: o turno vai sem a mensagem, como antes.
 */
export const FATOS_NO_CONTEXTO = 5;
export const TETO_POR_CAMPO = 240;
export const TETO_DO_TEXTO = 2000;

function cortar(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  return limpo.length > TETO_POR_CAMPO
    ? `${limpo.slice(0, TETO_POR_CAMPO)}…`
    : limpo;
}

export function textoDoPerfilDoAutor(
  fatos: readonly UserContextFact[],
  total: number,
): string | null {
  const usados = fatos.slice(0, FATOS_NO_CONTEXTO);
  if (usados.length === 0) return null;

  const linhas = usados.map(
    (f) =>
      `- [${cortar(f.agenteAlvo)}] ${cortar(f.hipotese)} — ajuste: ${cortar(f.sugestao)}`,
  );
  const recorte =
    total > usados.length
      ? `\n(os ${usados.length} mais recentes de ${total})`
      : '';

  const texto =
    'Fatos do perfil de quem escreveu esta mensagem — hipóteses sobre como ' +
    'trabalhar com esta pessoa que ELA aceitou neste projeto. Use como ' +
    'preferência dela; o rótulo entre colchetes é o agente a que a hipótese ' +
    `se dirigia.\n${linhas.join('\n')}${recorte}`;

  return texto.length > TETO_DO_TEXTO
    ? `${texto.slice(0, TETO_DO_TEXTO - 1)}…`
    : texto;
}
