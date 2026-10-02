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

/**
 * O que o chamador sabe de cada evento citado como evidência: quem o
 * escreveu e o tipo. É o que permite separar OBSERVAÇÃO de AUSÊNCIA (RN-716).
 */
export interface EvidenceEventInfo {
  type: string;
  actorKind: string;
  actorId: string;
}

/**
 * Cliques de aprovação: dizem que a pessoa CONFIOU (ou teve pressa), nunca
 * que domina o conteúdo aprovado. Não contam como evidência de competência
 * (RN-716, AT-376: "aprova 2 ADRs sem hesitar" virava arquitetura avançada).
 */
export const EVENTOS_DE_APROVACAO_SEM_LEITURA: readonly string[] = [
  'proposed_action.approved',
  'handoff.accepted',
  'readiness.confirmed',
];

/**
 * Evidência que OBSERVA a pessoa: evento escrito por ELA e que não é um
 * clique de aprovação. Evento de outro ator (o agente que mexeu no git, a
 * infra que subiu container) é ausência de oportunidade para a pessoa, não
 * evidência de pouco conhecimento.
 */
export function ehEvidenciaObservadaDaPessoa(
  info: EvidenceEventInfo,
  userId: string,
): boolean {
  return (
    info.actorKind === 'user' &&
    info.actorId === userId &&
    !EVENTOS_DE_APROVACAO_SEM_LEITURA.includes(info.type)
  );
}

export type ProficiencyBatchValidation =
  { ok: true } | { ok: false; reason: string };

/**
 * `catalog` vem de deriveCatalog(stacks) — é o guarda-corpo que impede
 * qualquer competência sensível. `knownEventIds` mapeia os ids que existem
 * de verdade no event log do projeto para autor e tipo (RN-716). `allowedUserIds` são os membros
 * NÃO opted-out: um usuário que apagou o perfil não pode voltar a ser
 * perfilado por um lote do modelo.
 */
export function validateProficiencyBatch(
  drafts: ProficiencyDraft[],
  catalog: Set<string>,
  knownEventIds: Map<string, EvidenceEventInfo>,
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

    // RN-716: competência NÃO OBSERVADA não ganha nível. Sem um evento da
    // própria pessoa interagindo com o conteúdo, o estado é "não observado",
    // e ele não grava perfil nenhum — nem "iniciante".
    const observada = draft.evidenceEventIds.some((id) => {
      const info = knownEventIds.get(id);
      return (
        info !== undefined && ehEvidenciaObservadaDaPessoa(info, draft.userId)
      );
    });
    if (!observada) {
      return {
        ok: false,
        reason:
          `${label}: competência NÃO OBSERVADA — nenhuma evidência é uma interação da própria pessoa com o conteúdo ` +
          `(eventos de outros atores são ausência de oportunidade, e aprovar sem abrir é confiança, não domínio). ` +
          `Retire este perfil do lote; se nada sobrar, encerre com skip_proficiency`,
      };
    }
  }

  return { ok: true };
}
