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
    // KEYCLOAK_URL precisa ser alcançável a partir do container da api
    // (ex.: http://keycloak:8080 na rede do docker-compose) — é de lá
    // que o JWKS é buscado. Já o `iss` dentro do token reflete o
    // hostname que o CLIENTE usou pra pedir o token (ex.:
    // http://localhost:8080, se o login veio do host) — por isso a
    // validação do issuer usa KEYCLOAK_ISSUER_URL separadamente,
    // caindo pra KEYCLOAK_URL quando não fizer diferença (fora do
    // docker, os dois costumam ser o mesmo valor).
    const baseUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
    const issuerBaseUrl = process.env.KEYCLOAK_ISSUER_URL ?? baseUrl;
    const realm = process.env.KEYCLOAK_REALM ?? 'brabo-dev';
    this.issuer = `${issuerBaseUrl}/realms/${realm}`;
    this.jwks = createRemoteJWKSet(
      new URL(`${baseUrl}/realms/${realm}/protocol/openid-connect/certs`),
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
