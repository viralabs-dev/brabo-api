import type { ModelBindingScope } from './model-binding-scope';
import type { ModelAvailability } from './model.entity';

// Mais específico primeiro — papel de sessão sobrepõe agente, que sobrepõe
// área, que sobrepõe projeto, que sobrepõe workspace.
//
// `area` entrou na FASE 23 (ADR 0064) e a POSIÇÃO dela é a decisão, não o
// nível em si: o modelo da área é o PADRÃO que lead e subagentes compartilham,
// e o binding do agente é a DIVERGÊNCIA explícita de um deles. Se a área
// viesse acima do agente, divergir seria impossível — a área venceria sempre,
// e "padrão herdável" viraria "padrão imposto".
const PRECEDENCE: readonly ModelBindingScope[] = [
  'session',
  'agent',
  'area',
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
   * projeto" em vez de trocar o modelo em silêncio (RN-043).
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
 * chat-only e violaria a RN-040 EM SILÊNCIO — a falha só apareceria depois, no
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

/**
 * O agente que serve de MODELO DE START quando ninguém configurou nada.
 *
 * O Criativo é sempre a porta de entrada de um projeto: é com ele que a
 * primeira conversa acontece, e é o binding dele que representa "o modelo que
 * este projeto usa para pensar".
 */
export const AGENTE_DE_START = 'criativo';

/**
 * Herda o modelo do Criativo quando a cascata pousou no default do WORKSPACE.
 *
 * ## O que isto conserta
 *
 * O default de workspace é global e costuma ser um modelo local pequeno. Sessão
 * nova e dev agent — que não têm binding próprio — nasciam nele, e o ADR 0020
 * proíbe modelo local pequeno no passo semântico. Numa execução real foi
 * preciso trocar o modelo À MÃO em toda sessão aberta, e os três dev agents
 * subiram em `llama3.2:1b` sem ninguém pedir.
 *
 * ## Por que só quando a origem é `workspace`
 *
 * `workspace` é o único escopo que ninguém escolheu para ESTE projeto: é o
 * default global, o que sobra quando não há decisão. Binding de sessão, de
 * agente ou de projeto são escolhas explícitas de alguém, e continuam vencendo
 * — herdar por cima delas seria o produto desfazendo configuração do usuário.
 *
 * É por isso que a herança é um passo DEPOIS da cascata, e não um escopo novo
 * dentro dela: ela não compete por precedência, só ocupa o vazio.
 */
export function herdarModeloDeStart(
  resolvido: ResolvedBinding | null,
  doCriativo: ScopedBinding | null,
  exigeToolCalling = false,
): ResolvedBinding | null {
  if (!resolvido || resolvido.origin !== 'workspace') return resolvido;
  if (!doCriativo) return resolvido;

  // O modelo do Criativo passa pelos mesmos filtros que a cascata aplica — não
  // faria sentido pular um modelo sumido no escopo do agente e aceitá-lo aqui.
  if (doCriativo.availability === 'unavailable') return resolvido;
  if (exigeToolCalling && !doCriativo.supportsToolCalling) return resolvido;

  return {
    modelId: doCriativo.modelId,
    // A origem continua sendo `agent`: quem lê "de onde veio" precisa ver que
    // veio de um agente, não inventar um escopo que não existe no banco.
    origin: 'agent',
    skipped: resolvido.skipped,
  };
}
