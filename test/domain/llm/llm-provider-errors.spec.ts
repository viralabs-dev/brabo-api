import { describe, expect, it } from 'vitest';
import {
  LIMITE_DO_DETALHE,
  normalizeHttpStatus,
} from '../../../src/domain/llm/llm-provider-errors';

// RN-886 (AT-534): o 403 de orçamento do OpenRouter (TP-01, 14/10).
const CORPO_403_ORCAMENTO = JSON.stringify({
  error: {
    message: 'Budget limit exceeded (monthly limit)',
    code: 403,
    metadata: {
      limit_source: 'openrouter_guardrail_budget',
      limit_usd: 30,
      spend_usd: 30.02,
      resets_at: '2026-11-01T00:00:00.000Z',
    },
  },
});

describe('normalizeHttpStatus — 403 de orçamento (RN-886)', () => {
  it('o 403 de orçamento vira insufficient_credit com o corpo inteiro', () => {
    const erro = normalizeHttpStatus('openrouter', 403, CORPO_403_ORCAMENTO);
    expect(erro.code).toBe('insufficient_credit');
    expect(erro.message).toContain('"resets_at":"2026-11-01T00:00:00.000Z"');
  });

  it('403 sem marcador de orçamento continua credencial rejeitada', () => {
    const erro = normalizeHttpStatus(
      'openrouter',
      403,
      '{"error":"forbidden"}',
    );
    expect(erro.code).toBe('auth');
  });
});

// RN-739: o corpo do 402 medido no TP-01 (03/10) com o `metadata` inteiro.
const CORPO_402 = JSON.stringify({
  error: {
    message:
      'This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 1032. To increase, visit https://openrouter.ai/settings/credits and add more credits',
    code: 402,
    metadata: { reason: 'insufficient_credits', provider_name: null },
  },
  user_id: 'user_2abcDEFghiJKLmnoPQRstuVWXyz',
});

describe('normalizeHttpStatus — detalhe do corpo (RN-739)', () => {
  it('leva o metadata.reason do provider inteiro na mensagem', () => {
    const erro = normalizeHttpStatus('openrouter', 402, CORPO_402);
    expect(erro.message).toContain(
      '"metadata":{"reason":"insufficient_credits"',
    );
    expect(erro.message).not.toContain('…');
  });

  it('corta corpo acima do teto explícito', () => {
    const erro = normalizeHttpStatus(
      'openrouter',
      500,
      'x'.repeat(LIMITE_DO_DETALHE + 50),
    );
    expect(erro.message.endsWith('…')).toBe(true);
    expect(erro.message).not.toContain('x'.repeat(LIMITE_DO_DETALHE + 1));
  });
});
