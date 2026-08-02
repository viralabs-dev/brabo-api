import type { LLMProviderName } from '@brabo/shared';

// Fase 11a (ADR 0041/0042): falha no teste de conexão de uma credencial de
// LLM antes de persistir — nunca lançado depois de gravar nada. Mesmo
// vocabulário e mesmo momento do `GitCredentialConnectionTestFailedError`
// (docs/adr/0004-git-credential-registration.md), mas em arquivo próprio: não
// é a taxonomia de `LLMErrorCode` de `llm-provider-errors.ts`, que é sobre
// o protocolo de chat/catálogo, não sobre cadastro de credencial.
export class LLMCredentialConnectionTestFailedError extends Error {
  constructor(
    readonly provider: LLMProviderName,
    readonly reason?: string,
  ) {
    super(
      `teste de conexão falhou para ${provider}${reason ? `: ${reason}` : ''}`,
    );
    this.name = 'LLMCredentialConnectionTestFailedError';
  }
}
