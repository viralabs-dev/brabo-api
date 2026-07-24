import { describe, it, expect } from 'vitest';
import { deriveCatalog } from '../../../src/domain/anamnese/competency-catalog';
import {
  validateProficiencyBatch,
  type ProficiencyDraft,
} from '../../../src/domain/anamnese/proficiency-validation';

const catalog = deriveCatalog(['NestJS']);
const knownEventIds = new Set(['evt-1', 'evt-2']);
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
});
