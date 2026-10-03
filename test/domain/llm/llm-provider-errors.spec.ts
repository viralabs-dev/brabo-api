import { describe, expect, it } from 'vitest';
import {
  LIMITE_DO_DETALHE,
  normalizeHttpStatus,
} from '../../../src/domain/llm/llm-provider-errors';

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
