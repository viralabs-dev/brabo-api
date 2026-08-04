import type { CredentialProviderName } from '@brabo/shared';

/**
 * Projeção segura — nunca contém o segredo (nem cifrado nem plano).
 * É o único formato de credencial que atravessa a fronteira HTTP.
 * `provider` cobre tanto chaves de LLM quanto tokens de git de usuário
 * (github/gitlab) — ver docs/adr/0004-git-credential-registration.md.
 */
export interface UserCredentialMetadata {
  id: string;
  provider: CredentialProviderName;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Teto de caracteres de uma credencial — chave de LLM ou token de git.
 *
 * É **proteção, não validação de formato**, mesma natureza do `@MaxLength` da
 * senha em `domain/auth/password-policy.ts`: impede que alguém mande um
 * payload absurdo por uma rota que cifra (e portanto copia) a entrada, e não
 * tem opinião nenhuma sobre o que é uma chave boa. Quem responde isso é o
 * provider, pela rota de teste (ADR 0050).
 *
 * O valor é FOLGADO de propósito. A maior credencial conhecida entre os nove
 * providers é a project key da OpenAI, na casa dos 164 caracteres; a da
 * Anthropic passa de 100. Um teto apertado voltaria a recusar cadastro de
 * chave boa — exatamente o modo de falha que o ADR 0050 removeu —, e quando
 * um provider alongar o formato ninguém se lembraria deste número.
 */
export const CREDENCIAL_COMPRIMENTO_MAXIMO = 512;
