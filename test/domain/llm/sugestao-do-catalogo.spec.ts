import { describe, expect, it } from 'vitest';
import { sugestaoDoModelo } from '../../../src/domain/llm/sugestao-do-catalogo';

describe('sugestaoDoModelo', () => {
  it('Haiku 5.5 no provider anthropic: 0,10 / 0,50, sem faixa', () => {
    const s = sugestaoDoModelo('anthropic', 'claude-haiku-5-5');
    expect(s?.cobranca).toBeNull();
    expect(s?.preco).toMatchObject({
      entradaMicros: 100_000,
      saidaMicros: 500_000,
    });
  });

  it('9router: alias vira faixa e o preço casa sem o alias', () => {
    const s = sugestaoDoModelo('9router', 'cc/claude-haiku-5-5');
    expect(s?.cobranca).toBe('subscription');
    expect(s?.preco?.entradaMicros).toBe(100_000);
    expect(sugestaoDoModelo('9router', 'cx/gpt-x')?.cobranca).toBe(
      'subscription',
    );
    expect(sugestaoDoModelo('9router', 'bzl/auto:free')?.cobranca).toBe('free');
    expect(sugestaoDoModelo('9router', 'ollama/qwen')?.cobranca).toBe('free');
    expect(sugestaoDoModelo('9router', 'nvidia/x')).toEqual({
      cobranca: 'api',
      preco: null,
    });
  });

  it('openrouter, id fora da tabela e provider sem faixa: sem sugestão', () => {
    expect(
      sugestaoDoModelo('openrouter', 'anthropic/claude-haiku-5.5'),
    ).toBeNull();
    expect(sugestaoDoModelo('anthropic', 'claude-haiku-5-5[1m]')).toBeNull();
    expect(sugestaoDoModelo('ollama', 'llama3')).toBeNull();
  });
});
