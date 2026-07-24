// Regra de prontidão de história (Fase 3b, CLAUDE.md 3b.7): uma story só sai
// de `draft` para `ready` se tiver DoD e DoR não vazios, ao menos 1 requisito
// funcional (RF) e ao menos 1 regra de negócio vinculada. "validação no
// domínio, não só no prompt".
//
// Puro e sem IO — recebe uma view mínima da story já carregada e decide; o
// use-case faz o IO (espelha domain/sessions/agent-activation.ts).

export interface StoryReadinessView {
  dod: string[];
  dor: string[];
  rf: string[];
  businessRuleIds: string[];
}

export type ReadinessRequirement = 'dod' | 'dor' | 'rf' | 'business_rule';

const REQUIREMENT_LABEL: Record<ReadinessRequirement, string> = {
  dod: 'DoD (Definition of Done)',
  dor: 'DoR (Definition of Ready)',
  rf: 'ao menos 1 requisito funcional',
  business_rule: 'ao menos 1 regra de negócio vinculada',
};

export class StoryNotReadyError extends Error {
  readonly missing: ReadinessRequirement[];

  constructor(missing: ReadinessRequirement[]) {
    super(
      `História não pode ir para "ready": falta ${missing
        .map((m) => REQUIREMENT_LABEL[m])
        .join(', ')}`,
    );
    this.name = 'StoryNotReadyError';
    this.missing = missing;
  }
}

export function missingForReady(
  story: StoryReadinessView,
): ReadinessRequirement[] {
  const missing: ReadinessRequirement[] = [];
  if (story.dod.length === 0) missing.push('dod');
  if (story.dor.length === 0) missing.push('dor');
  if (story.rf.length === 0) missing.push('rf');
  if (story.businessRuleIds.length === 0) missing.push('business_rule');
  return missing;
}

export function canBecomeReady(story: StoryReadinessView): boolean {
  return missingForReady(story).length === 0;
}

export function assertReady(story: StoryReadinessView): void {
  const missing = missingForReady(story);
  if (missing.length > 0) {
    throw new StoryNotReadyError(missing);
  }
}
