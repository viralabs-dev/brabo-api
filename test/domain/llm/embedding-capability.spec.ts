import { describe, expect, it } from 'vitest';
import type { LLMProviderCapabilities } from '@brabo/shared';
import {
  ModelNotFitForEmbeddingError,
  ProviderCannotEmbedError,
  assertCanEmbed,
  isEmbeddingOnlyModel,
} from '../../../src/domain/llm/embedding-capability';

const QUE_EMBEDA: LLMProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  listModels: true,
  embeddings: true,
};
const QUE_NAO_EMBEDA: LLMProviderCapabilities = {
  ...QUE_EMBEDA,
  embeddings: false,
};

describe('capability de embedding em duas camadas (ADR 0075)', () => {
  it('caminho feliz: provider que embeda + modelo declarado de embedding', () => {
    expect(() =>
      assertCanEmbed(
        { name: 'ollama', capabilities: QUE_EMBEDA },
        { name: 'nomic-embed-text', supportsEmbeddings: true },
      ),
    ).not.toThrow();
  });

  it('provider sem a capability recusa ANTES de olhar o modelo', () => {
    // A ordem importa: trocar de modelo não resolve provider que não embeda, e
    // uma mensagem sobre o modelo mandaria quem lê para o lugar errado.
    expect(() =>
      assertCanEmbed(
        { name: 'anthropic', capabilities: QUE_NAO_EMBEDA },
        { name: 'nomic-embed-text', supportsEmbeddings: true },
      ),
    ).toThrow(ProviderCannotEmbedError);
  });

  it('modelo de CHAT não embeda, mesmo em provider que embeda', () => {
    // O caso real: o daemon do Ollama responde `501 This server does not
    // support embeddings` para `llama3.2`. A recusa aqui é a mesma falha,
    // antecipada para onde ela é legível.
    const erro = pegar(() =>
      assertCanEmbed(
        { name: 'ollama', capabilities: QUE_EMBEDA },
        { name: 'llama3.2:1b', supportsEmbeddings: false },
      ),
    );

    expect(erro).toBeInstanceOf(ModelNotFitForEmbeddingError);
    expect((erro as ModelNotFitForEmbeddingError).declarado).toBe(false);
    expect(erro?.message).toMatch(/de chat/);
  });

  it('catálogo que NÃO declarou não vira permissão — e a mensagem é outra', () => {
    // Ausência é "não sabemos" (ADR 0041), nunca "pode". A distinção existe
    // porque a ação de quem lê é diferente: sincronizar o catálogo, e não
    // trocar de modelo.
    const erro = pegar(() =>
      assertCanEmbed(
        { name: 'ollama', capabilities: QUE_EMBEDA },
        { name: 'modelo-sem-declaracao' },
      ),
    );

    expect(erro).toBeInstanceOf(ModelNotFitForEmbeddingError);
    expect((erro as ModelNotFitForEmbeddingError).declarado).toBeUndefined();
    expect(erro?.message).toMatch(/Sincronize o catálogo/);
  });

  it('o inverso também é exclusão: modelo de embedding não é modelo de conversa', () => {
    expect(isEmbeddingOnlyModel({ supportsEmbeddings: true })).toBe(true);
    expect(isEmbeddingOnlyModel({ supportsEmbeddings: false })).toBe(false);
    expect(isEmbeddingOnlyModel({})).toBe(false);
  });
});

function pegar(fn: () => void): Error | undefined {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  return undefined;
}
