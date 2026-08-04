import type { GitCredentialProviderName } from '@brabo/shared';

/**
 * Os providers de git que têm token de usuário, em RUNTIME.
 *
 * Mesmo motivo de `domain/llm/llm-provider-names.ts` para a lista morar aqui e
 * não em `packages/shared` (que é 100% tipo). E mesmo motivo para existir: até
 * o ADR 0050 o par `['github', 'gitlab']` estava escrito à mão no DTO de
 * cadastro, e o despacho "esta credencial é de git ou de LLM?" precisava de um
 * terceiro lugar com a mesma lista. Uma só, derivada.
 */
export const GIT_CREDENTIAL_PROVIDER_NAMES = [
  'github',
  'gitlab',
] as const satisfies readonly GitCredentialProviderName[];

/** Exaustividade nos dois sentidos, como na lista de LLM. */
type NomeDeFora = Exclude<
  GitCredentialProviderName,
  (typeof GIT_CREDENTIAL_PROVIDER_NAMES)[number]
>;
const _todosListados: NomeDeFora extends never ? true : never = true;
void _todosListados;

export function isGitCredentialProvider(
  provider: string,
): provider is GitCredentialProviderName {
  return (GIT_CREDENTIAL_PROVIDER_NAMES as readonly string[]).includes(
    provider,
  );
}
