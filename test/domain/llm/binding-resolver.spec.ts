import { describe, it, expect } from 'vitest';
import {
  resolveBinding,
  type ScopedBinding,
} from '../../../src/domain/llm/binding-resolver';
import type { ModelBindingScope } from '../../../src/domain/llm/model-binding-scope';

function candidato(
  scope: ModelBindingScope,
  modelId: string,
  overrides: Partial<ScopedBinding> = {},
): ScopedBinding {
  return {
    scope,
    modelId,
    availability: 'available',
    supportsToolCalling: true,
    ...overrides,
  };
}

describe('resolveBinding', () => {
  it('caminho feliz: sessão sobrepõe agente, projeto e workspace', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
      candidato('project', 'project-model'),
      candidato('agent', 'agent-model'),
      candidato('session', 'session-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'session-model',
      origin: 'session',
      skipped: [],
    });
  });

  it('agente sobrepõe projeto e workspace quando não há binding de sessão', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
      candidato('project', 'project-model'),
      candidato('agent', 'agent-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'agent-model',
      origin: 'agent',
      skipped: [],
    });
  });

  it('projeto sobrepõe workspace quando só esses dois existem', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
      candidato('project', 'project-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'project-model',
      origin: 'project',
      skipped: [],
    });
  });

  it('cai pro workspace quando é o único candidato', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'workspace-model',
      origin: 'workspace',
      skipped: [],
    });
  });

  it('retorna null sem nenhum candidato', () => {
    expect(resolveBinding([])).toBeNull();
  });

  // --- Fase 9c (RN-041) ---

  it('pula o modelo indisponível e diz QUAL escopo foi pulado', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
      candidato('agent', 'sumiu-do-provider', {
        availability: 'unavailable',
      }),
    ]);

    expect(resolved).toEqual({
      modelId: 'workspace-model',
      origin: 'workspace',
      skipped: [
        {
          scope: 'agent',
          modelId: 'sumiu-do-provider',
          reason: 'unavailable',
        },
      ],
    });
  });

  it('revalida tool calling A CADA nível quando o pedido é de agente', () => {
    // Sem isso o fallback pousaria num modelo chat-only e a violação da RN-038
    // só apareceria lá na frente, no ToolLoop, como "o agente parou sozinho".
    const resolved = resolveBinding(
      [
        candidato('workspace', 'workspace-com-tools'),
        candidato('project', 'project-chat-only', {
          supportsToolCalling: false,
        }),
        candidato('agent', 'agent-sumiu', { availability: 'unavailable' }),
      ],
      true,
    );

    expect(resolved).toEqual({
      modelId: 'workspace-com-tools',
      origin: 'workspace',
      skipped: [
        { scope: 'agent', modelId: 'agent-sumiu', reason: 'unavailable' },
        {
          scope: 'project',
          modelId: 'project-chat-only',
          reason: 'sem_tool_calling',
        },
      ],
    });
  });

  it('aceita modelo chat-only quando o turno não pede ferramentas', () => {
    const resolved = resolveBinding([
      candidato('project', 'project-chat-only', {
        supportsToolCalling: false,
      }),
    ]);
    expect(resolved?.modelId).toBe('project-chat-only');
  });

  it('falha: nenhum candidato serve — devolve null sem escolher no chute', () => {
    const resolved = resolveBinding(
      [
        candidato('project', 'chat-only', { supportsToolCalling: false }),
        candidato('agent', 'sumiu', { availability: 'unavailable' }),
      ],
      true,
    );
    expect(resolved).toBeNull();
  });
});
