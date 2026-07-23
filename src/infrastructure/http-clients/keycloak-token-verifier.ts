import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import {
  TokenVerifier,
  type VerifiedToken,
} from '../../application/ports/token-verifier.port';

@Injectable()
export class KeycloakTokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly issuers: string[];

  constructor() {
    // KEYCLOAK_URL precisa ser alcançável a partir do container da api
    // (ex.: http://keycloak:8080 na rede do docker-compose) — é de lá
    // que o JWKS é buscado. Já o `iss` dentro do token reflete o
    // hostname que o CLIENTE usou pra pedir o token — e isso varia
    // por CHAMADOR: um humano via browser/curl do host pede via
    // KEYCLOAK_ISSUER_URL (ex. http://localhost:8080), mas um serviço
    // interno (ex. o engine, buscando um token client-credentials) pede
    // de dentro da rede do docker, via KEYCLOAK_URL (ex.
    // http://keycloak:8080) — os dois são o MESMO realm, só hostnames
    // diferentes, então ambos precisam ser aceitos como issuer válido
    // (jose aceita `issuer` como array). Fora do docker, os dois
    // costumam ser o mesmo valor (o Set dedup cuida disso).
    const baseUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
    const issuerBaseUrl = process.env.KEYCLOAK_ISSUER_URL ?? baseUrl;
    const realm = process.env.KEYCLOAK_REALM ?? 'brabo-dev';
    this.issuers = [...new Set([baseUrl, issuerBaseUrl])].map(
      (url) => `${url}/realms/${realm}`,
    );
    this.jwks = createRemoteJWKSet(
      new URL(`${baseUrl}/realms/${realm}/protocol/openid-connect/certs`),
    );
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.issuers,
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
      clientId: typeof payload.azp === 'string' ? payload.azp : null,
    };
  }
}
