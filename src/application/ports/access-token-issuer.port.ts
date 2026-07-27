export interface ClaimsDoAcesso {
  userId: string;
  email: string;
}

export interface AcessoEmitido {
  token: string;
  /** Segundos até expirar — o que o cliente precisa para agendar o refresh. */
  expiresIn: number;
}

export interface JwkPublica {
  kty: string;
  crv: string;
  x: string;
  kid: string;
  alg: string;
  use: string;
}

/**
 * Porta de emissão e verificação do access token (Fase 7a, item 1).
 *
 * Fica separada do `TokenVerifier` da Fase 1 de propósito: aquele é a porta
 * que o `JwtAuthGuard` consome e que a 7.2 vai reapontar. Enquanto o Keycloak
 * segue emitindo, os dois coexistem sem se enxergar.
 */
export abstract class AccessTokenIssuer {
  abstract emitir(claims: ClaimsDoAcesso): Promise<AcessoEmitido>;
  abstract verificar(token: string): Promise<ClaimsDoAcesso>;
  /** As chaves públicas ativas — a atual e, durante rotação, a anterior. */
  abstract jwks(): Promise<{ keys: JwkPublica[] }>;
}
