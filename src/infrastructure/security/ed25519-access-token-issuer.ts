import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, calculateJwkThumbprint, jwtVerify } from 'jose';
import {
  AccessTokenIssuer,
  type AcessoEmitido,
  type ClaimsDoAcesso,
  type JwkPublica,
} from '../../application/ports/access-token-issuer.port';
import {
  derivarParEd25519,
  passphraseAnterior,
  passphraseAtual,
  type ParDeChaves,
} from './auth-key-material';

const EMISSOR = 'brabo-api';
const AUDIENCIA = 'brabo';
const ALGORITMO = 'EdDSA';

interface ChaveComKid {
  par: ParDeChaves;
  kid: string;
  jwk: JwkPublica;
}

/**
 * Access token EdDSA (Ed25519) de vida curta — Fase 7a, item 1.
 *
 * ## Por que EdDSA e não HS256
 *
 * Com par de chaves, a pública pode ser publicada em `/.well-known/jwks.json`
 * e qualquer serviço verifica sem receber o segredo que ASSINA. Com HMAC,
 * quem verifica também pode forjar — e o dia em que um segundo serviço
 * precisar validar token de usuário, a escolha já estaria feita e errada.
 *
 * ## `kid` derivado, não configurado
 *
 * O `kid` é o thumbprint RFC 7638 da própria JWK. Sai da chave, então não
 * existe variável de ambiente para desincronizar da chave que ela nomeia — o
 * modo de falha clássico de `kid` configurado à mão, onde a rotação troca a
 * chave e esquece o identificador.
 *
 * ## Rotação
 *
 * `AUTH_JWT_SECRET_PREVIOUS` entra no JWKS e é aceita na verificação, mas
 * NUNCA assina: token novo já nasce na chave nova, e os antigos continuam
 * válidos até expirarem (15 min). Passada a janela, a variável sai. Mesmo
 * desenho do `CREDENTIALS_MASTER_KEY_PREVIOUS`.
 */
@Injectable()
export class Ed25519AccessTokenIssuer extends AccessTokenIssuer {
  private readonly logger = new Logger(Ed25519AccessTokenIssuer.name);
  private readonly ttlSegundos = Math.floor(
    Number(process.env.AUTH_ACCESS_TOKEN_TTL_MS ?? 900_000) / 1000,
  );

  private atualCache: ChaveComKid | null = null;
  private anteriorCache: ChaveComKid | null | undefined;

  async emitir(claims: ClaimsDoAcesso): Promise<AcessoEmitido> {
    const { par, kid } = await this.atual();
    const agora = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({ email: claims.email })
      .setProtectedHeader({ alg: ALGORITMO, kid })
      .setSubject(claims.userId)
      .setIssuer(EMISSOR)
      .setAudience(AUDIENCIA)
      .setIssuedAt(agora)
      .setExpirationTime(agora + this.ttlSegundos)
      .sign(par.privada);

    return { token, expiresIn: this.ttlSegundos };
  }

  /**
   * Verifica contra a chave atual e, se falhar, contra a anterior.
   *
   * A ordem importa: em operação normal não existe chave anterior e o custo é
   * uma verificação só. Durante a rotação, o token velho paga uma verificação
   * extra — que é o preço de não deslogar todo mundo ao trocar a chave.
   */
  async verificar(token: string): Promise<ClaimsDoAcesso> {
    const candidatas = [await this.atual(), await this.anterior()].filter(
      (c): c is ChaveComKid => c !== null,
    );

    let ultimoErro: unknown;
    for (const candidata of candidatas) {
      try {
        const { payload } = await jwtVerify(token, candidata.par.publica, {
          issuer: EMISSOR,
          audience: AUDIENCIA,
          algorithms: [ALGORITMO],
        });
        if (!payload.sub || typeof payload.email !== 'string') {
          throw new Error('claims obrigatórias ausentes');
        }
        return { userId: payload.sub, email: payload.email };
      } catch (erro) {
        ultimoErro = erro;
      }
    }
    throw ultimoErro instanceof Error
      ? ultimoErro
      : new Error('token inválido');
  }

  async jwks(): Promise<{ keys: JwkPublica[] }> {
    const anterior = await this.anterior();
    const chaves = [(await this.atual()).jwk];
    if (anterior) chaves.push(anterior.jwk);
    return { keys: chaves };
  }

  private async atual(): Promise<ChaveComKid> {
    this.atualCache ??= await this.montar(passphraseAtual());
    return this.atualCache;
  }

  private async anterior(): Promise<ChaveComKid | null> {
    if (this.anteriorCache === undefined) {
      const passphrase = passphraseAnterior();
      if (passphrase) {
        // Visível de propósito, igual ao aviso do EnvelopeEncryptionService:
        // rodar por tempo indeterminado aceitando duas chaves dobra a
        // superfície de uma chave vazada. O log é o lembrete de que a rotação
        // tem que TERMINAR.
        this.logger.warn(
          'AUTH_JWT_SECRET_PREVIOUS está definida — rotação em andamento. ' +
            'Remova a variável quando todos os tokens antigos tiverem expirado.',
        );
      }
      this.anteriorCache = passphrase ? await this.montar(passphrase) : null;
    }
    return this.anteriorCache;
  }

  private async montar(passphrase: string): Promise<ChaveComKid> {
    const par = derivarParEd25519(passphrase);
    const jwkBruta = par.publica.export({ format: 'jwk' }) as {
      kty: string;
      crv: string;
      x: string;
    };
    const kid = await calculateJwkThumbprint(jwkBruta);

    return {
      par,
      kid,
      jwk: { ...jwkBruta, kid, alg: ALGORITMO, use: 'sig' },
    };
  }
}
