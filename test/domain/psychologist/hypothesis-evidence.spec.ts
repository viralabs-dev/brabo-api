import { describe, it, expect } from 'vitest';
import {
  validateHypothesisBatch,
  type HypothesisDraft,
} from '../../../src/domain/psychologist/hypothesis-evidence';

function draft(overrides: Partial<HypothesisDraft> = {}): HypothesisDraft {
  return {
    agenteAlvo: 'dev-api',
    observacao: 'observação',
    hipotese: 'hipótese',
    sugestao: 'sugestão',
    confiancaPercent: 70,
    evidenceEventIds: ['evt-1'],
    terminationAnalysis: null,
    ...overrides,
  };
}

describe('validateHypothesisBatch', () => {
  it('lote válido (evidência real, confiança em faixa) passa', () => {
    const result = validateHypothesisBatch(
      [draft()],
      new Set(['evt-1']),
      false,
    );
    expect(result.ok).toBe(true);
  });

  it('lote vazio é rejeitado', () => {
    const result = validateHypothesisBatch([], new Set(['evt-1']), false);
    expect(result.ok).toBe(false);
  });

  it('evidenceEventIds vazio é rejeitado', () => {
    const result = validateHypothesisBatch(
      [draft({ evidenceEventIds: [] })],
      new Set(['evt-1']),
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('sem evidência');
  });

  it('event id inexistente (fora do knownEventIds) é rejeitado', () => {
    const result = validateHypothesisBatch(
      [draft({ evidenceEventIds: ['evt-fantasma'] })],
      new Set(['evt-1']),
      false,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('evt-fantasma');
  });

  it('event id de OUTRA sessão (não presente no knownEventIds resolvido pro chamador) é rejeitado', () => {
    // knownEventIds representa só os ids que pertencem À SESSÃO analisada
    // — um id de outra sessão nunca entra nesse set, então cai no mesmo
    // caminho de "não corresponde a um evento real desta sessão".
    const result = validateHypothesisBatch(
      [draft({ evidenceEventIds: ['evt-de-outra-sessao'] })],
      new Set(['evt-1', 'evt-2']),
      false,
    );
    expect(result.ok).toBe(false);
  });

  it('confiancaPercent fora de [0,100] é rejeitado', () => {
    const result = validateHypothesisBatch(
      [draft({ confiancaPercent: 150 })],
      new Set(['evt-1']),
      false,
    );
    expect(result.ok).toBe(false);
  });

  it('confiancaPercent não-inteiro é rejeitado', () => {
    const result = validateHypothesisBatch(
      [draft({ confiancaPercent: 70.5 })],
      new Set(['evt-1']),
      false,
    );
    expect(result.ok).toBe(false);
  });

  it('sessão closed_abnormally sem nenhuma terminationAnalysis no lote é rejeitada', () => {
    const result = validateHypothesisBatch(
      [draft({ terminationAnalysis: null })],
      new Set(['evt-1']),
      true,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('terminationAnalysis');
  });

  it('sessão closed_abnormally com terminationAnalysis em ao menos uma hipótese do lote passa', () => {
    const result = validateHypothesisBatch(
      [
        draft({ terminationAnalysis: null }),
        draft({
          terminationAnalysis: {
            causa: 'kill',
            estadoDaSessao: 'em andamento',
            analise: 'processo morto externamente',
          },
        }),
      ],
      new Set(['evt-1']),
      true,
    );
    expect(result.ok).toBe(true);
  });
});
