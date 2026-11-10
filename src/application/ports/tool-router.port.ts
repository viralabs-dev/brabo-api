import type {
  MotivoDaQueda,
  PedidoAoJev,
  RespostaDoJev,
} from '../../domain/llm/tool-router';

/**
 * A porta do roteador de ferramenta (AT-238, ADR 0179). PRÓPRIA e FORA do
 * contrato `LLMProvider` do ADR 0041: o Jev não conversa, decide, e por isso
 * não está no `LLMProviderRegistry`, não passa pela suíte de contrato de
 * provider e não aparece no catálogo `models`.
 *
 * O contrato é "nunca lança": toda falha volta como `queda` NOMEADA, e é assim
 * que o turno nunca falha por causa do Jev.
 */
export interface DecisaoDoRoteador {
  status: 'decidido';
  resposta: Extract<RespostaDoJev, { status: 'ok' }>;
  latenciaMs: number;
  /** Quem decidiu (`MODELO_DO_JEV` ou `MODELO_DO_LAYA`); vai para o `tool_router.decided`. */
  modelo: string;
}

export interface QuedaDoRoteador {
  status: 'queda';
  motivo: Extract<
    MotivoDaQueda,
    | 'timeout'
    | 'erro_http'
    | 'erro_de_rede'
    | 'resposta_invalida'
    | 'escolha_fora_das_opcoes'
  >;
  detalhe: string;
  latenciaMs: number;
  modelo: string;
  /** Quando a resposta trouxe `usage`, o gasto é real mesmo sem decisão. */
  custoUsd: number | null;
  tokensDeEntrada: number | null;
  tokensDeSaida: number | null;
}

export type ResultadoDoRoteador = DecisaoDoRoteador | QuedaDoRoteador;

export interface DecidirFerramentaInput {
  /** A chave OpenRouter do dono do workspace (RN-058), já decifrada. O Laya (local) não usa. */
  apiKey?: string;
  pedido: PedidoAoJev;
  /** Os nomes do catálogo do passo (sem a opção reservada). */
  opcoes: readonly string[];
}

export abstract class ToolRouter {
  abstract decidir(input: DecidirFerramentaInput): Promise<ResultadoDoRoteador>;
}

/** O roteador LOCAL (Laya, AT-626): outro token, escolhido por workspace. */
export abstract class ToolRouterLocal extends ToolRouter {}
