import type { ModelBindingScope } from './model-binding-scope';

// Mais específico primeiro — papel de sessão sobrepõe agente, que
// sobrepõe projeto, que sobrepõe workspace.
const PRECEDENCE: readonly ModelBindingScope[] = [
  'session',
  'agent',
  'project',
  'workspace',
];

export interface ScopedBinding {
  scope: ModelBindingScope;
  modelId: string;
}

export interface ResolvedBinding {
  modelId: string;
  origin: ModelBindingScope;
}

/**
 * Aplica a cascata de precedência sobre os candidatos disponíveis
 * (um binding por escopo, no máximo) e expõe a origem do valor
 * resolvido. Puro — quem chama já buscou os candidatos aplicáveis.
 */
export function resolveBinding(
  candidates: ScopedBinding[],
): ResolvedBinding | null {
  for (const scope of PRECEDENCE) {
    const match = candidates.find((candidate) => candidate.scope === scope);
    if (match) return { modelId: match.modelId, origin: match.scope };
  }
  return null;
}
