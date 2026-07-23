import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { InvalidOauthStateError } from './git-provider-errors';

export type GitOauthProviderName = 'github' | 'gitlab';

const STATE_TTL_MS = 10 * 60 * 1000;

export interface OauthStatePayload {
  projectId: string;
  userId: string;
  provider: GitOauthProviderName;
  nonce: string;
  expiresAt: number;
}

export interface OauthStateInput {
  projectId: string;
  userId: string;
  provider: GitOauthProviderName;
}

/**
 * `state` stateless e HMAC-assinado — sem tabela nova, sem job de
 * limpeza. TTL curto embutido no próprio payload.
 */
export function signOauthState(input: OauthStateInput, secret: string): string {
  const payload: OauthStatePayload = {
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    expiresAt: Date.now() + STATE_TTL_MS,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyOauthState(
  token: string,
  secret: string,
  expectedProvider: GitOauthProviderName,
): OauthStatePayload {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    throw new InvalidOauthStateError('state malformado');
  }

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEquals(signature, expectedSignature)) {
    throw new InvalidOauthStateError('assinatura do state inválida');
  }

  let payload: OauthStatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as OauthStatePayload;
  } catch {
    throw new InvalidOauthStateError('payload do state ilegível');
  }

  if (payload.expiresAt < Date.now()) {
    throw new InvalidOauthStateError('state expirado');
  }
  if (payload.provider !== expectedProvider) {
    throw new InvalidOauthStateError('state emitido para outro provider');
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
