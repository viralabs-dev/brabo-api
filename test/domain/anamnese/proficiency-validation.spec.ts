import { describe, it, expect } from 'vitest';
import { deriveCatalog } from '../../../src/domain/anamnese/competency-catalog';
import {
  validateProficiencyBatch,
  type ProficiencyDraft,
} from '../../../src/domain/anamnese/proficiency-validation';

const catalog = deriveCatalog(['NestJS']);
const knownEventIds = new Map([
  ['evt-1', { type: 'chat.message', actorKind: 'user', actorId: 'user-1' }],
  ['evt-2', { type: 'chat.message', actorKind: 'user', actorId: 'user-1' }],
  // RN-716: o agente mexeu no git — a pessoa não teve oportunidade.
  ['evt-agente', { type: 'tool.call', actorKind: 'agent', actorId: 'dev-api' }],
  // RN-716: aprovar sem abrir é confiança, não domínio.
  [
    'evt-aprovou',
    { type: 'proposed_action.approved', actorKind: 'user', actorId: 'user-1' },
  ],
]);
const allowedUserIds = new Set(['user-1']);

function draft(overrides: Partial<ProficiencyDraft> = {}): ProficiencyDraft {
  return {
    userId: 'user-1',
    competency: 'nestjs',
    level: 'avancado',
    rationale: 'corrigiu o agente em detalhes de injeção de dependência',
    evidenceEventIds: ['evt-1'],
    ...overrides,
  };
}

function validate(drafts: ProficiencyDraft[]) {
  return validateProficiencyBatch(
    drafts,
    catalog,
    knownEventIds,
    allowedUserIds,
  );
}

describe('validateProficiencyBatch', () => {
  it('lote válido passa', () => {
    expect(validate([draft()]).ok).toBe(true);
  });

  it('lote vazio é rejeitado', () => {
    expect(validate([]).ok).toBe(false);
  });

  it('competência fora do catálogo rejeita o lote inteiro', () => {
    const result = validate([draft({ competency: 'saúde mental' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('catálogo permitido');
  });

  it('usuário opted-out (fora dos elegíveis) rejeita o lote', () => {
    const result = validate([draft({ userId: 'user-optou-fora' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('não é membro elegível');
  });

  it('nível inválido rejeita o lote', () => {
    const result = validate([draft({ level: 'ninja' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('nível');
  });

  it('rationale vazio rejeita (os "porquês" são obrigatórios)', () => {
    const result = validate([draft({ rationale: '   ' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('rationale');
  });

  it('evidência vazia rejeita', () => {
    const result = validate([draft({ evidenceEventIds: [] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('sem evidência');
  });

  it('evidência apontando pra evento inexistente rejeita', () => {
    const result = validate([draft({ evidenceEventIds: ['evt-fantasma'] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('evt-fantasma');
  });

  it('uma entrada inválida no meio do lote reprova o lote todo (atômico)', () => {
    const result = validate([
      draft(),
      draft({ competency: 'personalidade' }),
      draft({ competency: 'git' }),
    ]);
    expect(result.ok).toBe(false);
  });

  it('RN-716: só evidência de outro ator é "não observado" e não grava nível', () => {
    const result = validate([
      draft({
        competency: 'git',
        level: 'iniciante',
        evidenceEventIds: ['evt-agente'],
      }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('NÃO OBSERVADA');
  });

  it('RN-716: aprovação sem leitura não é evidência de competência', () => {
    const result = validate([draft({ evidenceEventIds: ['evt-aprovou'] })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('confiança, não domínio');
  });

  it('RN-716: aprovação ao lado de interação da pessoa passa', () => {
    expect(
      validate([draft({ evidenceEventIds: ['evt-aprovou', 'evt-1'] })]).ok,
    ).toBe(true);
  });
});
