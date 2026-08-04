import type { LLMProviderName } from '@brabo/shared';

/**
 * Teste de conexão real contra o provider, hoje chamado por
 * `TestStoredCredentialUseCase` sobre uma credencial JÁ gravada (ADR 0050).
 * Até a Fase 11a ele era o portão do cadastro — rodava antes de cifrar e
 * recusava a gravação; o ADR 0050 explica por que essa ordem invertia o
 * problema em vez de resolvê-lo.
 *
 * Nem todo provider tem um jeito conhecido de testar a chave — `ollama` não
 * usa API key, e `openai`/`anthropic` não tiveram o endpoint de teste
 * verificado ainda. Para esses, `supports()` devolve `false` e `test()` é
 * NO-OP.
 *
 * `supports()` existe porque o silêncio de `test()` é ambíguo: sem ele, um
 * provider sem teste declarado seria indistinguível de um teste que passou, e
 * a tela diria "chave ok" para uma chave que ninguém verificou — mentira pior
 * que a ausência de resposta. É a mesma regra que vale para capability de
 * provider (ADR 0041): só se declara o que foi provado.
 *
 * `test()` lança `LLMCredentialConnectionTestFailedError` em qualquer falha
 * (chave inválida/revogada, rede, timeout) — nunca deixa passar
 * silenciosamente.
 */
export abstract class LLMCredentialConnectionTester {
  abstract supports(provider: LLMProviderName): boolean;
  abstract test(provider: LLMProviderName, apiKey: string): Promise<void>;
}
