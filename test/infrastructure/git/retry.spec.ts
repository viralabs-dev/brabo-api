import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../../src/infrastructure/git/retry';

// Delays reais mas minúsculos (não fake timers) — evita a complexidade
// de sincronizar timers falsos com a cadeia de promises do withRetry;
// como os testes controlam baseDelayMs/maxDelayMs diretamente, o tempo
// real gasto é irrelevante (poucos ms no total).
const FAST = { baseDelayMs: 1, maxDelayMs: 2 };

describe('withRetry', () => {
  it('caminho feliz: retorna no primeiro sucesso sem tentar de novo', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, FAST);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo em falha e retorna assim que suceder', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transitório'))
      .mockRejectedValueOnce(new Error('transitório'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { ...FAST, maxAttempts: 5 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('esgota as tentativas e lança o último erro', async () => {
    const error = new Error('sempre falha');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(withRetry(fn, { ...FAST, maxAttempts: 3 })).rejects.toThrow(
      'sempre falha',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('shouldRetry=false pra um erro específico não tenta de novo', async () => {
    class PermanentError extends Error {}
    const fn = vi.fn().mockRejectedValue(new PermanentError('não retentável'));

    await expect(
      withRetry(fn, {
        ...FAST,
        maxAttempts: 5,
        shouldRetry: (error) => !(error instanceof PermanentError),
      }),
    ).rejects.toThrow('não retentável');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
