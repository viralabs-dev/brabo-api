import type { ProposedAction } from './proposed-action.entity';

/** O slug de `supersedes`, aceitando `docs/adr/<slug>.md` como atalho. */
export function slugDeSupersedes(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const slug = valor
    .trim()
    .replace(/^docs\/adr\//, '')
    .replace(/\.md$/, '');
  return slug === '' ? null : slug;
}

/**
 * RN-1069 (AT-806, ADR 0283): a ADR nova declara qual substitui. Por que o
 * `supersedes` de uma `open_adr_pr` não vale — `null` quando vale. Pura.
 *
 * A citada precisa ser uma `open_adr_pr` DESTE projeto (`adrsDoProjeto` já é
 * escopada por projeto) já aceita pelo usuário: `executed` (aprovada, PR
 * aberta/mergeada). Pendente, negada ou falha não é ADR em vigor para
 * substituir. Substituir a si mesma também é recusado.
 */
export function recusaDeSupersedes(
  supersedes: unknown,
  slugNovo: unknown,
  adrsDoProjeto: readonly ProposedAction[],
): string | null {
  if (supersedes === undefined || supersedes === null) return null;
  const slug = slugDeSupersedes(supersedes);
  if (!slug) return '`supersedes` precisa ser o slug de uma ADR do projeto.';
  if (slug === slugNovo) return 'Uma ADR não substitui a si mesma.';
  const citada = adrsDoProjeto.find(
    (a) =>
      a.actionType === 'open_adr_pr' &&
      slugDeSupersedes((a.payload as { slug?: unknown })?.slug) === slug,
  );
  if (!citada) {
    return `A ADR "${slug}" não existe neste projeto: confira o slug em listar_adrs_propostas.`;
  }
  if (citada.status !== 'executed') {
    return `A ADR "${slug}" está "${citada.status}": só se substitui ADR já aceita (aberta ou mergeada).`;
  }
  return null;
}
