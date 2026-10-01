import type { Model } from './model.entity';

/**
 * O alias de ROTEAMENTO LIVRE do OpenRouter — o id que começa com `~`, como
 * `~deepseek/deepseek-flash-latest`, que "sempre redireciona para o último da
 * família" (AT-271, RN-679).
 *
 * O catálogo publica para ele um preço de VITRINE (no uso real de 29/09, o do
 * endpoint mais barato da família), a lista de endpoints vem vazia, e quem
 * cobra é o upstream que atendeu cada chamada. Não há upstream fixo contra o
 * qual o preço congelado no metering (ADR 0042) signifique alguma coisa — e a
 * decisão do dono (01/10) é PROIBIR, não preçar por upstream: só entra na
 * curadoria modelo com upstream fixo.
 *
 * A régua é do PROVIDER: `~` é sintaxe do OpenRouter, e nenhum outro catálogo
 * o usa com esse sentido. Por isso a pergunta leva `provider` e `name` juntos —
 * casar só o prefixo recusaria, num provider futuro, um nome que não é alias.
 *
 * O sync NÃO filtra o alias: ele continua no catálogo, marcado, porque sumir
 * dali faria o sync marcar `unavailable` o que já estava curado (a cascata
 * pularia os bindings em silêncio) e esconderia da tela o motivo da recusa.
 */
export function ehAliasDeRoteamentoLivre(
  model: Pick<Model, 'provider' | 'name'>,
): boolean {
  return model.provider === 'openrouter' && model.name.startsWith('~');
}

/** Código da recusa no corpo do 422 — a tela casa por ele, nunca por texto. */
export const CODIGO_ALIAS_DE_ROTEAMENTO_LIVRE = 'alias_de_roteamento_livre';

/**
 * Ativar alias `~` num workspace. Recusa o LOTE inteiro, como o 404 do id
 * inexistente: a tela marcou N linhas e precisa saber que nenhuma mudou.
 *
 * Só ATIVAR recusa. Desativar um alias já curado continua permitido — é a
 * saída de quem o tinha ligado antes da regra —, e o que já estava ativo NÃO
 * é desligado por ninguém: os bindings dele seguem resolvendo, e o catálogo o
 * mostra marcado. Desligado, ele não volta.
 */
export class AliasDeRoteamentoLivreError extends Error {
  readonly code = CODIGO_ALIAS_DE_ROTEAMENTO_LIVRE;

  constructor(readonly models: Pick<Model, 'id' | 'name'>[]) {
    super(
      `Alias de roteamento livre não entra na curadoria: ` +
        `${models.map((m) => m.name).join(', ')}. ` +
        `O preço do catálogo é de vitrine e quem cobra é o upstream que ` +
        `atender cada chamada; ative um modelo com upstream fixo.`,
    );
    this.name = 'AliasDeRoteamentoLivreError';
  }
}
