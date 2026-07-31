import { describe, expect, it } from 'vitest';
import {
  ModelNotFitForAgentScopeError,
  assertModelFitsBindingScope,
} from '../../../src/domain/llm/model-capabilities';
import type { Model } from '../../../src/domain/llm/model.entity';
import { MODEL_BINDING_SCOPES } from '../../../src/domain/llm/model-binding-scope';

function modelo(overrides: Partial<Model> = {}): Model {
  return {
    id: 'm1',
    provider: 'openai',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    inputPricePerMillionMicros: 0,
    outputPricePerMillionMicros: 0,
    contextWindow: null,
    supportsToolCalling: true,
    supportsStreaming: true,
    supportsVision: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('assertModelFitsBindingScope (RN-038)', () => {
  it('aceita modelo com tool calling nativo em qualquer escopo', () => {
    for (const scope of MODEL_BINDING_SCOPES) {
      expect(() => assertModelFitsBindingScope(modelo(), scope)).not.toThrow();
    }
  });

  it('recusa modelo chat-only no escopo agent', () => {
    const chatOnly = modelo({
      supportsToolCalling: false,
      displayName: 'Modelo Tagarela',
    });

    expect(() => assertModelFitsBindingScope(chatOnly, 'agent')).toThrow(
      ModelNotFitForAgentScopeError,
    );
  });

  it('a mensagem aponta o filtro que o usuário precisa usar', () => {
    const chatOnly = modelo({
      supportsToolCalling: false,
      displayName: 'Modelo Tagarela',
    });

    // Sem este ponteiro a recusa vira beco sem saída: o usuário não descobre
    // sozinho quais modelos servem.
    expect(() => assertModelFitsBindingScope(chatOnly, 'agent')).toThrow(
      /aptos para agentes/,
    );
    expect(() => assertModelFitsBindingScope(chatOnly, 'agent')).toThrow(
      /Modelo Tagarela/,
    );
  });

  it('deixa passar modelo chat-only fora do escopo agent', () => {
    const chatOnly = modelo({ supportsToolCalling: false });

    // workspace/project são o fallback do chat humano e session é conversa —
    // nenhum deles roda ToolLoop.
    for (const scope of ['workspace', 'project', 'session'] as const) {
      expect(() => assertModelFitsBindingScope(chatOnly, scope)).not.toThrow();
    }
  });
});
