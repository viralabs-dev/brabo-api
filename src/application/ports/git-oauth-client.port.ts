import type { GitOauthProviderName } from '../../domain/git/oauth-state';

export interface OauthTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  accountLogin: string | null;
  accountMetadata: Record<string, unknown>;
}

/**
 * Identidade do titular do access token (RN-272..286, ADR 0084) — usada só
 * pelo login social, nunca pelo fluxo de conexão de git.
 *
 * `providerUserId` é o id NUMÉRICO/estável do provider, nunca o login — que
 * pode mudar de nome sem avisar ninguém. `emailVerified` vem do PROVIDER, não
 * é inferido: só ele sabe se confirmou aquele endereço.
 */
export interface OauthIdentity {
  providerUserId: string;
  login: string | null;
  email: string | null;
  emailVerified: boolean;
}

export abstract class GitOauthClient {
  abstract readonly provider: GitOauthProviderName;
  abstract buildAuthorizeUrl(state: string, redirectUri: string): string;
  abstract exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OauthTokenResult>;

  /**
   * URL de autorização para LOGIN social — escopo PRÓPRIO e mínimo (perfil +
   * e-mail), nunca o `repo`/`api` do fluxo de conexão de git. Entrar na conta
   * não deveria pedir acesso a repositório nenhum.
   */
  abstract buildLoginAuthorizeUrl(state: string, redirectUri: string): string;

  /**
   * Identidade de quem autorizou — chamada logo após `exchangeCode` no fluxo
   * de login social. Método PRÓPRIO, e não campo a mais em `OauthTokenResult`,
   * para o fluxo de CONEXÃO de git (que também usa `exchangeCode`) não pagar
   * uma chamada a mais ao provider que ele nunca consome.
   */
  abstract fetchIdentity(accessToken: string): Promise<OauthIdentity>;
}

export abstract class GitOauthClientRegistry {
  abstract get(provider: GitOauthProviderName): GitOauthClient;
}
