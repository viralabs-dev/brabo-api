import type { Model } from './model.entity';
import type { ModelBindingScope } from './model-binding-scope';

/**
 * Um agente só existe dentro do ToolLoop, e o ToolLoop só funciona se o modelo
 * souber PEDIR ferramentas (Fase 9a — ADR 0041, RN-040).
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
 * binding NOVO (Fase 9c, RN-043). Os bindings que já existem continuam de pé —
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

/**
 * `ativoNoWorkspace` chega de fora porque a curadoria deixou de ser atributo
 * do modelo: ela é uma linha de `workspace_models`, e a mesma linha de
 * `models` pode estar ligada num workspace e desligada no vizinho (ADR 0049).
 *
 * `null` quer dizer "não há workspace nesta pergunta" — e aí só a
 * disponibilidade é checada. Desde o ADR 0064 sobra um único escopo assim, o
 * `session`, que não chega aqui com projeto na mão: `agent` e `area` passaram a
 * carregar o projeto no próprio `scope_id` e agora respondem pela curadoria
 * como os outros dois. Fingir uma resposta ali seria inventar um workspace;
 * deixar explícito mantém a lacuna visível.
 */
export function assertModelIsBindable(
  model: Model,
  ativoNoWorkspace: boolean | null,
): void {
  if (ativoNoWorkspace === false) {
    throw new ModelNotBindableError(model, 'inativo');
  }
  if (model.availability === 'unavailable') {
    throw new ModelNotBindableError(model, 'indisponivel');
  }
}

/**
 * Só os escopos `agent` e `area` são validados. `workspace` e `project` são o
 * fallback do chat humano — travá-los proibiria modelo chat-only no produto
 * inteiro, que não é o que a regra quer. O escopo `session` também fica livre:
 * uma sessão de conversa não roda ToolLoop.
 *
 * `area` entrou junto na FASE 23 (ADR 0064) porque ela NÃO é um fallback
 * genérico: o único consumidor do modelo de uma área é um agente dela, lead ou
 * subagente. Deixá-la passar seria admitir um padrão que a cascata teria de
 * pular em todo agente que o herdasse — a mesma falha silenciosa da RN-040,
 * atrasada em um nível.
 *
 * O agente `context-manager` (ADR 0007) é coberto por construção: ele é um
 * slug DENTRO do escopo `agent`, não um escopo próprio.
 */
export function assertModelFitsBindingScope(
  model: Model,
  scope: ModelBindingScope,
): void {
  const exigeFerramentas = scope === 'agent' || scope === 'area';
  if (exigeFerramentas && !model.supportsToolCalling) {
    throw new ModelNotFitForAgentScopeError(model);
  }
}
