import type {
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  LLMProviderCapabilities,
  LLMProviderName,
} from '@brabo/shared';

export abstract class LLMProvider {
  abstract readonly name: LLMProviderName;
  /**
   * O TETO do que este provider sabe fazer (Fase 9a — ADR 0040). Espelha o
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
}
