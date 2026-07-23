import { describe, it, expect } from 'vitest';
import { resolveBinding } from '../../../src/domain/llm/binding-resolver';

describe('resolveBinding', () => {
  it('caminho feliz: sessão sobrepõe agente, projeto e workspace', () => {
    const resolved = resolveBinding([
      { scope: 'workspace', modelId: 'workspace-model' },
      { scope: 'project', modelId: 'project-model' },
      { scope: 'agent', modelId: 'agent-model' },
      { scope: 'session', modelId: 'session-model' },
    ]);
    expect(resolved).toEqual({ modelId: 'session-model', origin: 'session' });
  });

  it('agente sobrepõe projeto e workspace quando não há binding de sessão', () => {
    const resolved = resolveBinding([
      { scope: 'workspace', modelId: 'workspace-model' },
      { scope: 'project', modelId: 'project-model' },
      { scope: 'agent', modelId: 'agent-model' },
    ]);
    expect(resolved).toEqual({ modelId: 'agent-model', origin: 'agent' });
  });

  it('projeto sobrepõe workspace quando só esses dois existem', () => {
    const resolved = resolveBinding([
      { scope: 'workspace', modelId: 'workspace-model' },
      { scope: 'project', modelId: 'project-model' },
    ]);
    expect(resolved).toEqual({ modelId: 'project-model', origin: 'project' });
  });

  it('cai pro workspace quando é o único candidato', () => {
    const resolved = resolveBinding([
      { scope: 'workspace', modelId: 'workspace-model' },
    ]);
    expect(resolved).toEqual({
      modelId: 'workspace-model',
      origin: 'workspace',
    });
  });

  it('retorna null sem nenhum candidato', () => {
    expect(resolveBinding([])).toBeNull();
  });
});
