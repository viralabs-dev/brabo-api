import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { GitOauthProviderName } from '../git/oauth-state';
import { InvalidSocialOauthStateError } from './social-oauth-errors';

/**
 * Mesmo conjunto de valores de `GitOauthProviderName` — são os dois únicos
 * providers com `GitOauthClient` registrado — mas um ALIAS próprio, e não uma
 * importação usada diretamente: este é o tipo do bounded context de AUTH, que
 * não deveria depender do de GIT para o próprio vocabulário, mesmo que hoje os
 * dois catálogos coincidam.
 */
export type SocialOauthProviderName = GitOauthProviderName;

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Discriminante fixo do PROPÓSITO deste `state` — o que o distingue do
 * `state` do fluxo de CONEXÃO de git (`domain/git/oauth-state.ts`).
 *
 * ## Por que isto existe (RN-273)
 *
 * Os dois fluxos assinam com a MESMA chave HMAC — `GIT_OAUTH_STATE_SECRET`,
 * via `resolveOauthStateSecret()` — porque não há necessidade de uma segunda
 * variável de ambiente só para isto (ver a nota em `oauth-state-secret.ts` e o
 * ADR 0084). Reusar a chave é seguro desde que os PAYLOADS sejam estruturalmente
 * incompatíveis — e é isso que este campo garante.
 *
 * Sem ele, um `state` de "conectar git ao projeto X" (que carrega `projectId` e
 * `userId` de quem já está autenticado) tem a MESMA assinatura válida contra a
 * mesma chave, e um verificador de login que não checasse o propósito o
 * aceitaria — o payload não tem os campos que este módulo lê, mas nada
 * IMPEDIRIA a leitura de campos `undefined` de virar um bug explorável mais
 * tarde. `verifySocialOauthState` recusa qualquer payload cujo `purpose` não
 * seja exatamente este valor, ANTES de olhar TTL ou provider.
 */
const PURPOSE = 'social_login' as const;

export interface SocialOauthStatePayload {
  purpose: typeof PURPOSE;
  provider: SocialOauthProviderName;
  nonce: string;
  expiresAt: number;
}

/** `state` stateless e HMAC-assinado, no mesmo desenho de `signOauthState`. */
export function signSocialOauthState(
  provider: SocialOauthProviderName,
  secret: string,
): string {
  const payload: SocialOauthStatePayload = {
    purpose: PURPOSE,
    provider,
    nonce: randomBytes(16).toString('base64url'),
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySocialOauthState(
  token: string,
  secret: string,
  expectedProvider: SocialOauthProviderName,
): SocialOauthStatePayload {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    throw new InvalidSocialOauthStateError('state malformado');
  }

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEquals(signature, expectedSignature)) {
    throw new InvalidSocialOauthStateError('assinatura do state inválida');
  }

  let payload: SocialOauthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as SocialOauthStatePayload;
  } catch {
    throw new InvalidSocialOauthStateError('payload do state ilegível');
  }

  // PRIMEIRO campo checado, de propósito — ver o docblock de `PURPOSE`.
  if (payload.purpose !== PURPOSE) {
    throw new InvalidSocialOauthStateError(
      'state emitido para outro propósito',
    );
  }
  if (payload.expiresAt < Date.now()) {
    throw new InvalidSocialOauthStateError('state expirado');
  }
  if (payload.provider !== expectedProvider) {
    throw new InvalidSocialOauthStateError('state emitido para outro provider');
  }

  return payload;
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
