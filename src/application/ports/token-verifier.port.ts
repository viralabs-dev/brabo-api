export interface VerifiedToken {
  /** O `users.id`. Desde a Fase 7a o emissor é a própria api. */
  sub: string;
  email: string;
  name: string | null;
}

/** Porta de verificação do access token — implementada por FirstPartyTokenVerifier. */
export abstract class TokenVerifier {
  abstract verify(token: string): Promise<VerifiedToken>;
}
