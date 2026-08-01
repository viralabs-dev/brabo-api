import type { ModelBindingScope } from './model-binding-scope';
import type { ModelAvailability } from './model.entity';

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
  /**
   * Estado do modelo apontado (Fase 9c). Antes o resolver só recebia o id e
   * não tinha como saber que o modelo tinha sumido do catálogo — a cascata era
   * sobre escopos, nunca sobre disponibilidade.
   */
  availability: ModelAvailability;
  supportsToolCalling: boolean;
}

export interface ResolvedBinding {
  modelId: string;
  origin: ModelBindingScope;
  /**
   * Escopos que a cascata PULOU por indisponibilidade ou falta de capability.
   * Existe para a UI conseguir dizer "o modelo do agente sumiu, caiu para o do
   * projeto" em vez de trocar o modelo em silêncio (RN-041).
   */
  skipped: SkippedBinding[];
}

export interface SkippedBinding {
  scope: ModelBindingScope;
  modelId: string;
  reason: 'unavailable' | 'sem_tool_calling';
}

/**
 * Aplica a cascata de precedência sobre os candidatos disponíveis
 * (um binding por escopo, no máximo) e expõe a origem do valor
 * resolvido. Puro — quem chama já buscou os candidatos aplicáveis.
 *
 * ## Por que a cascata revalida capability ao cair de nível (Fase 9c)
 *
 * Um binding de agente para modelo indisponível cai para o nível de baixo. Se
 * o resolver aceitasse qualquer coisa ali, um agente pousaria num modelo
 * chat-only e violaria a RN-038 EM SILÊNCIO — a falha só apareceria depois, no
 * ToolLoop, como "o agente parou sem concluir". Por isso o filtro de
 * `supportsToolCalling` vale para todo candidato quando o pedido é de agente,
 * não só para o primeiro.
 */
export function resolveBinding(
  candidates: ScopedBinding[],
  /** `true` quando quem vai usar o modelo é um agente (roda ToolLoop). */
  exigeToolCalling = false,
): ResolvedBinding | null {
  const skipped: SkippedBinding[] = [];

  for (const scope of PRECEDENCE) {
    const match = candidates.find((candidate) => candidate.scope === scope);
    if (!match) continue;

    if (match.availability === 'unavailable') {
      skipped.push({ scope, modelId: match.modelId, reason: 'unavailable' });
      continue;
    }
    if (exigeToolCalling && !match.supportsToolCalling) {
      skipped.push({
        scope,
        modelId: match.modelId,
        reason: 'sem_tool_calling',
      });
      continue;
    }

    return { modelId: match.modelId, origin: match.scope, skipped };
  }

  return null;
}
