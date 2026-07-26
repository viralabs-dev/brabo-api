// Validação do lote de perfis emitido pela Anamnese (Fase 4b) — puro,
// sem IO (o chamador já resolveu quais event ids existem, ver
// RecordProficiencyUseCase). Espelho exato de
// domain/psychologist/hypothesis-evidence.ts: lote inteiro rejeitado na
// primeira falha, com uma razão em pt-BR que vira o próximo tool-result
// pro modelo corrigir, dentro do teto de max_iterations do ToolLoop.

import { isAllowedCompetency } from './competency-catalog';

export const PROFICIENCY_LEVELS = [
  'iniciante',
  'intermediario',
  'avancado',
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export interface ProficiencyDraft {
  userId: string;
  competency: string;
  level: string;
  rationale: string;
  evidenceEventIds: string[];
}

export type ProficiencyBatchValidation =
  { ok: true } | { ok: false; reason: string };

/**
 * `catalog` vem de deriveCatalog(stacks) — é o guarda-corpo que impede
 * qualquer competência sensível. `knownEventIds` são os ids que existem
 * de verdade no event log do projeto. `allowedUserIds` são os membros
 * NÃO opted-out: um usuário que apagou o perfil não pode voltar a ser
 * perfilado por um lote do modelo.
 */
export function validateProficiencyBatch(
  drafts: ProficiencyDraft[],
  catalog: Set<string>,
  knownEventIds: Set<string>,
  allowedUserIds: Set<string>,
): ProficiencyBatchValidation {
  if (drafts.length === 0) {
    return { ok: false, reason: 'lote de perfis vazio' };
  }

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const label = `perfil #${i + 1} (${draft.competency || '?'})`;

    if (!allowedUserIds.has(draft.userId)) {
      return {
        ok: false,
        reason: `${label}: usuário "${draft.userId}" não é membro elegível do projeto (pode ter optado por não ser perfilado)`,
      };
    }

    if (!isAllowedCompetency(draft.competency, catalog)) {
      return {
        ok: false,
        reason: `${label}: competência fora do catálogo permitido — só stacks do module_map e competências de processo (${[...catalog].join(', ')})`,
      };
    }

    if (!(PROFICIENCY_LEVELS as readonly string[]).includes(draft.level)) {
      return {
        ok: false,
        reason: `${label}: nível "${draft.level}" inválido — use ${PROFICIENCY_LEVELS.join(' | ')}`,
      };
    }

    if (draft.rationale.trim() === '') {
      return {
        ok: false,
        reason: `${label}: rationale vazio (os "porquês" são obrigatórios)`,
      };
    }

    if (draft.evidenceEventIds.length === 0) {
      return {
        ok: false,
        reason: `${label}: sem evidência (evidenceEventIds vazio)`,
      };
    }

    const invalidId = draft.evidenceEventIds.find(
      (id) => !knownEventIds.has(id),
    );
    if (invalidId) {
      return {
        ok: false,
        reason: `${label}: evidência "${invalidId}" não corresponde a um evento real deste projeto`,
      };
    }
  }

  return { ok: true };
}
