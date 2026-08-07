import type { Story } from './backlog.entity';

/**
 * Detecção MECÂNICA de história repetida ou redundante (achado R).
 *
 * O que isto não é: um juiz de sinônimos. "Endpoint público de saudação
 * determinística" e "Endpoint público GET /hello que responde saudação
 * imediata" — o par exato do achado — continuam passando como distintos,
 * porque separá-los é julgamento e não cabe num `if`.
 *
 * O que sobra é o que dá para afirmar sem modelo, e são duas coisas
 * diferentes, com respostas diferentes de propósito:
 *
 *  - **título idêntico** é erro, não escolha: a história é RECUSADA;
 *  - **mesma justificativa** (as regras de negócio que a história cita já
 *    estavam todas cobertas por outra) é suspeita, não erro — um segundo
 *    recorte da mesma regra pode ser legítimo. Vira AVISO, e quem decide
 *    é o usuário.
 *
 * A normalização é gêmea da de `Engine.Harness.ArtifactDedupe`; as duas
 * existem porque uma roda no PO (api) e a outra no Criativo (engine).
 */
export function normalizarTitulo(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A primeira história do projeto com o mesmo título, se houver. */
export function tituloDuplicado(
  titulo: string,
  existentes: readonly Story[],
): Story | null {
  const alvo = normalizarTitulo(titulo);
  if (alvo === '') return null;

  return existentes.find((s) => normalizarTitulo(s.title) === alvo) ?? null;
}

/**
 * A história que já cobre TODAS as regras citadas pela nova.
 *
 * Contido, não intersecção: duas histórias compartilharem uma regra é
 * normal e avisar disso viraria ruído que ninguém lê. O sinal só existe
 * quando a nova não acrescenta cobertura nenhuma.
 *
 * História sem regra citada não gera aviso — não há o que comparar, e
 * tratar "nenhuma regra" como subconjunto de tudo acusaria todas.
 */
export function regrasJaCobertas(
  businessRuleIds: readonly string[],
  existentes: readonly Story[],
): Story | null {
  if (businessRuleIds.length === 0) return null;

  const novas = new Set(businessRuleIds);

  return (
    existentes.find((s) => {
      const dela = new Set(s.businessRuleIds ?? []);
      if (dela.size === 0) return false;
      return [...novas].every((id) => dela.has(id));
    }) ?? null
  );
}
