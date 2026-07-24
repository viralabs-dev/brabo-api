import type { GitCredentialProviderName } from '@brabo/shared';

/**
 * Teste de conexão real (GET no "usuário atual" da API do provider) —
 * chamado ANTES de qualquer cifra/persistência no fluxo de registro de
 * credencial de git. Lança `GitCredentialConnectionTestFailedError` em
 * qualquer falha (token inválido/revogado/sem escopo, rede, etc.) —
 * nunca deixa passar silenciosamente. Ver
 * docs/adr/0004-git-credential-registration.md.
 */
export abstract class GitCredentialConnectionTester {
  abstract test(
    provider: GitCredentialProviderName,
    token: string,
  ): Promise<void>;
}
