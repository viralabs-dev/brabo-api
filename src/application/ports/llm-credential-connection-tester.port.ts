import type { LLMProviderName } from '@brabo/shared';

/**
 * Teste de conexão real, chamado ANTES de cifrar/persistir uma credencial de
 * LLM (Fase 11a — primeira instância deste mecanismo do lado LLM; o lado git
 * tem o equivalente desde a Fase 2 sessão 2, `GitCredentialConnectionTester`).
 *
 * Nem todo provider tem um jeito conhecido de testar a chave — `ollama` não
 * usa API key, e `openai`/`anthropic` não tiveram o endpoint de teste
 * verificado ainda. Um provider sem teste declarado é um NO-OP aqui, não uma
 * exceção: preserva exatamente o comportamento de hoje (cifra e grava, sem
 * validar) até alguém verificar o endpoint certo na doc oficial de cada um.
 *
 * Lança `LLMCredentialConnectionTestFailedError` em qualquer falha (chave
 * inválida/revogada, rede, timeout) — nunca deixa passar silenciosamente.
 */
export abstract class LLMCredentialConnectionTester {
  abstract test(provider: LLMProviderName, apiKey: string): Promise<void>;
}
