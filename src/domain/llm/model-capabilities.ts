import type { Model } from './model.entity';
import type { ModelBindingScope } from './model-binding-scope';

/**
 * Um agente só existe dentro do ToolLoop, e o ToolLoop só funciona se o modelo
 * souber PEDIR ferramentas (Fase 9a — ADR 0040, RN-038).
 *
 * O `ToolCallRecovery` do engine (ADR 0020) resgata modelos que escrevem a
 * chamada em prosa em vez de usar o campo `tools` — mas ele é RESGATE, não
 * licença: depende do modelo acertar o formato por acaso e falha em silêncio
 * quando não acerta. Vincular um modelo chat-only a um agente é escolher esse
 * acaso de propósito, e é isso que a regra recusa.
 */
export class ModelNotFitForAgentScopeError extends Error {
  constructor(readonly model: Model) {
    super(
      `Modelo "${model.displayName}" não faz tool calling nativo e não pode ` +
        `ser vinculado a um agente. Use o filtro "aptos para agentes" no ` +
        `seletor de modelos.`,
    );
    this.name = 'ModelNotFitForAgentScopeError';
  }
}

/**
 * Modelo que o owner desligou, ou que sumiu do catálogo remoto, não recebe
 * binding NOVO (Fase 9c, RN-041). Os bindings que já existem continuam de pé —
 * quem os resolve é a cascata, que pula o indisponível e cai para o nível de
 * baixo avisando. Deletar o modelo nunca é opção: `token_usage` e
 * `model_bindings` apontam para ele.
 */
export class ModelNotBindableError extends Error {
  constructor(
    readonly model: Model,
    readonly motivo: 'inativo' | 'indisponivel',
  ) {
    super(
      motivo === 'inativo'
        ? `Modelo "${model.displayName}" está desativado. Ative-o no catálogo ` +
            `antes de vinculá-lo.`
        : `Modelo "${model.displayName}" não está mais disponível no ` +
            `provider. Escolha outro — os vínculos e o histórico dele são ` +
            `preservados.`,
    );
    this.name = 'ModelNotBindableError';
  }
}

export function assertModelIsBindable(model: Model): void {
  if (!model.isActive) throw new ModelNotBindableError(model, 'inativo');
  if (model.availability === 'unavailable') {
    throw new ModelNotBindableError(model, 'indisponivel');
  }
}

/**
 * Só o escopo `agent` é validado. `workspace` e `project` são o fallback do
 * chat humano — travá-los proibiria modelo chat-only no produto inteiro, que
 * não é o que a regra quer. O escopo `session` também fica livre: uma sessão
 * de conversa não roda ToolLoop.
 *
 * O agente `context-manager` (ADR 0007) é coberto por construção: ele é um
 * slug DENTRO do escopo `agent`, não um escopo próprio.
 */
export function assertModelFitsBindingScope(
  model: Model,
  scope: ModelBindingScope,
): void {
  if (scope === 'agent' && !model.supportsToolCalling) {
    throw new ModelNotFitForAgentScopeError(model);
  }
}
