export interface VerifiedToken {
  sub: string;
  email: string;
  name: string | null;
  clientId: string | null;
}

/** Porta para verificação de token — implementada pelo adapter Keycloak (jose/JWKS). */
export abstract class TokenVerifier {
  abstract verify(token: string): Promise<VerifiedToken>;
}
