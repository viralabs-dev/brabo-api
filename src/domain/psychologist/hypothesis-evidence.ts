// Validação de evidência das hipóteses do Psicólogo (Fase 4b): toda
// hipótese exige evidência apontando pra event ids REAIS da sessão
// analisada — puro, sem IO (o chamador já resolveu quais ids existem,
// ver ProposeHypothesesUseCase). Lote inteiro é rejeitado atomicamente se
// qualquer hipótese falhar (mesma disciplina de emit_artifact/
// emit_qa_verdict) — a mensagem de rejeição vira o próximo tool-result
// pro modelo corrigir, dentro do teto de max_iterations do ToolLoop
// ("até M tentativas").

export interface HypothesisDraft {
  agenteAlvo: string;
  observacao: string;
  hipotese: string;
  sugestao: string;
  confiancaPercent: number;
  evidenceEventIds: string[];
  terminationAnalysis?: {
    causa: string;
    estadoDaSessao: string;
    analise: string;
  } | null;
}

export type HypothesisBatchValidation =
  { ok: true } | { ok: false; reason: string };

/** Causas classificadas pelo engine — ver TerminationClassifier. */
export type TerminationCause =
  'normal' | 'timeout' | 'kill' | 'crash' | 'unknown';

/**
 * Toda causa que não seja `normal` exige a seção de análise de término.
 *
 * Antes isto era `session.status === 'closed_abnormally'`, e o timeout de
 * heartbeat escapava: o Monitor fecha essa sessão como `"closed"` de
 * propósito, então a seção nunca era exigida mesmo o enunciado nomeando
 * timeout ao lado de crash e kill. A causa vem do engine no payload; sem
 * ela (engine antigo), cai no status como antes.
 */
export function requiresTerminationAnalysis(
  cause: TerminationCause | undefined,
  sessionClosedAbnormally: boolean,
): boolean {
  return cause ? cause !== 'normal' : sessionClosedAbnormally;
}

/**
 * `knownEventIds` já foi resolvido pelo chamador (ids que existem E
 * pertencem à sessão analisada — ver SessionEventRepository.findById).
 * `requiresTermination` exige que PELO MENOS uma hipótese do lote traga
 * `terminationAnalysis` preenchida (a "seção adicional" da CLAUDE.md pra
 * términos anormais) — ver requiresTerminationAnalysis.
 */
export function validateHypothesisBatch(
  drafts: HypothesisDraft[],
  knownEventIds: Set<string>,
  requiresTermination: boolean,
): HypothesisBatchValidation {
  if (drafts.length === 0) {
    return { ok: false, reason: 'lote de hipóteses vazio' };
  }

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    const label = `hipótese #${i + 1} (${draft.agenteAlvo || '?'})`;

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
        reason: `${label}: evidência "${invalidId}" não corresponde a um evento real desta sessão`,
      };
    }

    if (
      !Number.isInteger(draft.confiancaPercent) ||
      draft.confiancaPercent < 0 ||
      draft.confiancaPercent > 100
    ) {
      return {
        ok: false,
        reason: `${label}: confiancaPercent deve ser um inteiro entre 0 e 100`,
      };
    }
  }

  if (
    requiresTermination &&
    !drafts.some((d) => d.terminationAnalysis != null)
  ) {
    return {
      ok: false,
      reason:
        'sessão encerrada anormalmente: ao menos uma hipótese precisa trazer terminationAnalysis (causa, estadoDaSessao, analise)',
    };
  }

  return { ok: true };
}
