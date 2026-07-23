import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  TokenVerifier,
  type VerifiedToken,
} from '../../application/ports/token-verifier.port';

@Injectable()
export class KeycloakTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuer: string;

  constructor() {
    const baseUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
    const realm = process.env.KEYCLOAK_REALM ?? 'brabo-dev';
    this.issuer = `${baseUrl}/realms/${realm}`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/protocol/openid-connect/certs`),
    );
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
    });

    if (!payload.sub) throw new Error('Token sem "sub"');

    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      name:
        (typeof payload.name === 'string' ? payload.name : null) ??
        (typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : null),
    };
  }
}
