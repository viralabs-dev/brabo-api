import { describe, expect, it } from 'vitest';
import { isOfficialPublisher } from '../../../src/domain/llm/huggingface-official-publishers';

describe('isOfficialPublisher', () => {
  it('reconhece um publisher do allowlist', () => {
    expect(isOfficialPublisher('meta-llama/Llama-3.1-8B-Instruct-GGUF')).toBe(
      true,
    );
    expect(isOfficialPublisher('Qwen/Qwen2.5-Coder-7B-Instruct-GGUF')).toBe(
      true,
    );
  });

  it('recusa um reupload de terceiro', () => {
    expect(isOfficialPublisher('bartowski/Llama-3.1-8B-Instruct-GGUF')).toBe(
      false,
    );
  });

  it('é sensível a caixa — "qwen" minúsculo não é a org oficial "Qwen"', () => {
    expect(isOfficialPublisher('qwen/algum-modelo')).toBe(false);
  });

  it('repoId sem publisher (sem "/") nunca casa com o allowlist', () => {
    expect(isOfficialPublisher('gpt2')).toBe(false);
  });
});
