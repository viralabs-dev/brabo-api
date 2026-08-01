import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
  ModeloDoCatalogo,
} from '@brabo/shared';

export abstract class LLMProvider {
  abstract readonly name: LLMProviderName;
  /**
   * O TETO do que este provider sabe fazer (Fase 9a — ADR 0041). Espelha o
   * `capabilities` que o `GitProviderContract` carrega desde a Fase 2: quem
   * consome degrada olhando a capability, em vez de descobrir na falha.
   *
   * Não confundir com as capabilities do MODELO (colunas `supports_*` de
   * `models`): um modelo pode ser mais pobre que o provider, nunca mais rico.
   */
  abstract readonly capabilities: LLMProviderCapabilities;
  abstract chat(
    messages: ChatMessage[],
    options: ChatOptions,
  ): AsyncGenerator<ChatStreamChunk>;

  /**
   * O catálogo remoto (Fase 9c). Só existe quando
   * `capabilities.listModels` é `true` — o contrato exige os dois lados juntos:
   * quem declara a capability implementa o método, e quem não declara não o
   * expõe.
   *
   * Diferente de `chat`, aqui um erro LANÇA em vez de virar chunk: não há
   * turno em andamento nem token gasto para preservar, e o sync precisa saber
   * a ORIGEM da falha para não marcar como indisponível um catálogo que só
   * não pôde ser lido.
   */
  listModels?(apiKey?: string): Promise<ModeloDoCatalogo[]>;
}
