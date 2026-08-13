import { describe, it, expect } from 'vitest';
import {
  herdarModeloDeStart,
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

  // FASE 23 / ADR 0064 — os três testes abaixo são a POSIÇÃO da área na
  // cascata, que é a decisão da fase: ela é o padrão de quem não decidiu, e
  // perde para o agente que decidiu.
  it('a área é o padrão: quem não tem binding de agente herda dela (RN-102)', () => {
    const resolved = resolveBinding([
      candidato('workspace', 'workspace-model'),
      candidato('project', 'project-model'),
      candidato('area', 'area-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'area-model',
      origin: 'area',
      skipped: [],
    });
  });

  it('o agente DIVERGE: binding próprio vence o padrão da área (RN-102)', () => {
    const resolved = resolveBinding([
      candidato('project', 'project-model'),
      candidato('area', 'area-model'),
      candidato('agent', 'agent-model'),
    ]);
    expect(resolved).toEqual({
      modelId: 'agent-model',
      origin: 'agent',
      skipped: [],
    });
  });

  it('a área entra na MESMA revalidação: modelo sumido cai para o projeto e avisa', () => {
    const resolved = resolveBinding([
      candidato('project', 'project-model'),
      candidato('area', 'area-sumiu', { availability: 'unavailable' }),
    ]);
    expect(resolved).toEqual({
      modelId: 'project-model',
      origin: 'project',
      skipped: [{ scope: 'area', modelId: 'area-sumiu', reason: 'unavailable' }],
    });
  });

  it('área chat-only não serve a turno com ferramentas — pula e registra', () => {
    const resolved = resolveBinding(
      [
        candidato('project', 'project-model'),
        candidato('area', 'area-tagarela', { supportsToolCalling: false }),
      ],
      true,
    );
    expect(resolved).toEqual({
      modelId: 'project-model',
      origin: 'project',
      skipped: [
        { scope: 'area', modelId: 'area-tagarela', reason: 'sem_tool_calling' },
      ],
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

  // --- Fase 9c (RN-043) ---

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
    // Sem isso o fallback pousaria num modelo chat-only e a violação da RN-040
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

/**
 * O modelo de START (achados B/O da execução real).
 *
 * O default de workspace é global e costuma ser um modelo local pequeno. Sessão
 * nova e dev agent nasciam nele — numa execução real foi preciso trocar à mão
 * em toda sessão aberta, e os três dev agents subiram em `llama3.2:1b`, que o
 * ADR 0020 proíbe no passo semântico.
 */
describe('herdarModeloDeStart', () => {
  const criativo = candidato('agent', 'deepseek');

  it('ocupa o vazio: origem `workspace` herda o modelo do Criativo', () => {
    const resolvido = resolveBinding([candidato('workspace', 'llama-1b')]);

    expect(herdarModeloDeStart(resolvido, criativo)).toMatchObject({
      modelId: 'deepseek',
      origin: 'agent',
    });
  });

  /**
   * A parte que importa: herdar por cima de uma escolha explícita seria o
   * produto desfazendo configuração do usuário.
   */
  it.each(['session', 'agent', 'project'] as const)(
    'NÃO sobrepõe escolha explícita de %s',
    (scope) => {
      const resolvido = resolveBinding([
        candidato(scope, 'escolhido'),
        candidato('workspace', 'llama-1b'),
      ]);

      expect(herdarModeloDeStart(resolvido, criativo)).toMatchObject({
        modelId: 'escolhido',
        origin: scope,
      });
    },
  );

  it('sem binding do Criativo, fica o do workspace', () => {
    const resolvido = resolveBinding([candidato('workspace', 'llama-1b')]);
    expect(herdarModeloDeStart(resolvido, null)?.modelId).toBe('llama-1b');
  });

  /**
   * O modelo herdado passa pelos MESMOS filtros da cascata — pular um modelo
   * sumido no escopo do agente e aceitá-lo aqui seria incoerente.
   */
  it('não herda modelo indisponível', () => {
    const resolvido = resolveBinding([candidato('workspace', 'llama-1b')]);
    const sumido = candidato('agent', 'deepseek', {
      availability: 'unavailable',
    });

    expect(herdarModeloDeStart(resolvido, sumido)?.modelId).toBe('llama-1b');
  });

  it('não herda modelo sem tool calling quando quem pede é agente', () => {
    const resolvido = resolveBinding(
      [candidato('workspace', 'llama-1b')],
      true,
    );
    const chatOnly = candidato('agent', 'deepseek', {
      supportsToolCalling: false,
    });

    expect(herdarModeloDeStart(resolvido, chatOnly, true)?.modelId).toBe(
      'llama-1b',
    );
  });

  it('preserva os escopos que a cascata pulou', () => {
    const resolvido = resolveBinding([
      candidato('project', 'sumido', { availability: 'unavailable' }),
      candidato('workspace', 'llama-1b'),
    ]);

    expect(herdarModeloDeStart(resolvido, criativo)?.skipped).toEqual([
      { scope: 'project', modelId: 'sumido', reason: 'unavailable' },
    ]);
  });

  it('sem binding nenhum continua sem nada para herdar', () => {
    expect(herdarModeloDeStart(null, criativo)).toBeNull();
  });
});
