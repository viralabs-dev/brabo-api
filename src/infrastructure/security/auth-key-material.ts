import {
  createHmac,
  createPrivateKey,
  createPublicKey,
  scryptSync,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { normalizarEmail } from '../../domain/auth/email';

/**
 * Material criptográfico do auth first-party (Fase 7a).
 *
 * ## Por que derivar, e não gerar
 *
 * O par Ed25519 nasce de `scryptSync(passphrase, salt, 32)` — o mesmo formato
 * que o `EnvelopeEncryptionService` já usa para a chave mestra das credenciais.
 * Isso resolve três coisas de uma vez:
 *
 * - nenhuma chave privada é commitada no repositório nem entra em manifesto;
 * - o par é IDÊNTICO entre réplicas e entre reinícios, então um token assinado
 *   por um pod verifica em qualquer outro. Um `generateKeyPairSync` no boot
 *   daria uma chave por processo, e o sintoma seria login funcionando de forma
 *   intermitente atrás do load balancer — caro de diagnosticar;
 * - a rotação copia o padrão que já existe (`_PREVIOUS` aceito só na
 *   verificação), em vez de inventar um segundo mecanismo.
 *
 * A semente do Ed25519 É a chave privada: 32 bytes, exatamente o que o scrypt
 * devolve. O envelope PKCS#8 é um prefixo DER constante — ver `PREFIXO_PKCS8`.
 *
 * ## Sobre os peppers
 *
 * Os peppers NÃO têm `_PREVIOUS`. Rotacionar `AUTH_TOKEN_PEPPER` invalida todo
 * refresh token e todo token de conta em aberto — é um logout global, não uma
 * perda de dado. Aceitar dupla verificação em todo refresh, para sempre, por um
 * cenário que roda uma vez a cada nunca, não paga. O runbook registra a
 * consequência.
 */

/**
 * Prefixo DER de uma chave privada Ed25519 em PKCS#8, seguido dos 32 bytes da
 * semente. É constante (RFC 8410): SEQUENCE, versão 0, OID 1.3.101.112,
 * OCTET STRING de 34 bytes contendo um OCTET STRING de 32.
 */
const PREFIXO_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

const SALT_SEMENTE_JWT = 'brabo-auth-jwt-seed';
const SALT_PEPPER_TOKEN = 'brabo-auth-token-pepper';
const SALT_PEPPER_BALDE = 'brabo-auth-bucket-pepper';
const SALT_DUMMY = 'brabo-auth-dummy-salt';

/**
 * Default de DESENVOLVIMENTO, público neste repositório (`.env.example`).
 *
 * Em produção ele é recusado pelo mesmo motivo do `GIT_OAUTH_STATE_SECRET`
 * (ADR 0059, RN-093, estendido pela RN-114): um segredo com valor padrão
 * conhecido não protege nada, e o `docker-compose.prod.yml` supria este
 * literal como fallback — o caminho real de erro tinha a variável DEFINIDA,
 * então "não vazia" não pegaria o defeito.
 */
const PASSPHRASE_PADRAO = 'dev-auth-jwt-secret-change-me';
const TAMANHO_MINIMO = 16;

export interface ParDeChaves {
  privada: KeyObject;
  publica: KeyObject;
}

/** Deriva o par Ed25519 a partir de uma passphrase qualquer. */
export function derivarParEd25519(passphrase: string): ParDeChaves {
  const semente = scryptSync(passphrase, SALT_SEMENTE_JWT, 32);
  const privada = createPrivateKey({
    key: Buffer.concat([PREFIXO_PKCS8, semente]),
    format: 'der',
    type: 'pkcs8',
  });
  return { privada, publica: createPublicKey(privada) };
}

/**
 * Resolve a passphrase de onde o par Ed25519 do access token é derivado.
 *
 * Mesma regra de `resolveOauthStateSecret()` (`oauth-state-secret.ts`): fora
 * de produção o default de desenvolvimento vale, para o `docker compose up`
 * sem `.env` continuar funcionando; em produção a variável é obrigatória, o
 * literal de exemplo é rejeitado mesmo definido explicitamente, e há um piso
 * de 16 caracteres (RN-114).
 */
export function passphraseAtual(): string {
  const producao = process.env.NODE_ENV === 'production';
  const bruto = (process.env.AUTH_JWT_SECRET ?? '').trim();

  if (!producao) {
    return bruto || PASSPHRASE_PADRAO;
  }

  if (!bruto) {
    throw new Error(
      'AUTH_JWT_SECRET é obrigatória em produção — dela deriva o par Ed25519 ' +
        'que assina o access token, e o default de desenvolvimento é público ' +
        'neste repositório.',
    );
  }

  if (bruto === PASSPHRASE_PADRAO) {
    throw new Error(
      'AUTH_JWT_SECRET está com o valor de exemplo do repositório, que é ' +
        'público — em produção isso equivale a assinar tokens com uma chave ' +
        'conhecida. Gere uma própria (ex.: `openssl rand -base64 32`).',
    );
  }

  if (bruto.length < TAMANHO_MINIMO) {
    throw new Error(
      `AUTH_JWT_SECRET tem ${bruto.length} caracteres; o mínimo em produção é ` +
        `${TAMANHO_MINIMO}. Gere uma aleatória (ex.: ` +
        '`openssl rand -base64 32`).',
    );
  }

  return bruto;
}

/**
 * A passphrase anterior, quando a rotação está em andamento.
 *
 * Devolve `null` quando ela é igual à atual — configurar as duas com o mesmo
 * valor não é rotação, e tratar como se fosse faria o JWKS publicar a mesma
 * chave duas vezes.
 */
export function passphraseAnterior(): string | null {
  const anterior = process.env.AUTH_JWT_SECRET_PREVIOUS;
  if (!anterior || anterior === passphraseAtual()) return null;
  return anterior;
}

function pepper(salt: string): Buffer {
  const base = process.env.AUTH_TOKEN_PEPPER ?? passphraseAtual();
  return scryptSync(base, salt, 32);
}

/**
 * Hash de um token opaco para guardar no banco.
 *
 * HMAC-SHA256, não argon2. O token tem 256 bits de aleatoriedade de CSPRNG:
 * não existe dicionário contra isso, então o custo do argon2 compraria zero
 * bit de segurança. Pior, argon2 tem salt por registro — o hash deixaria de
 * ser função só do token e `where token_hash = $1` ficaria impossível, o que
 * transformaria cada refresh numa varredura da tabela inteira.
 *
 * O pepper (em vez de SHA-256 puro) é de graça e faz um dump do banco, sem o
 * ambiente do processo, não valer nada.
 */
export function hashDeToken(tokenBruto: string): string {
  return createHmac('sha256', pepper(SALT_PEPPER_TOKEN))
    .update(tokenBruto)
    .digest('hex');
}

/**
 * Chave do balde de lockout de um e-mail.
 *
 * Keyed no E-MAIL NORMALIZADO, nunca no id do usuário. Com id, o balde só
 * existiria depois de encontrar a conta — tentativa contra e-mail inexistente
 * não seria contada nem bloqueada, e o próprio lockout viraria oráculo de
 * existência (basta comparar o comportamento na sexta tentativa). Com o
 * e-mail, real e imaginário se comportam igual, por construção.
 *
 * HMAC e não texto puro porque esta é uma tabela de abuso, de alto volume e
 * leitura ampla; guardar endereço em claro ali é vazamento de PII sem
 * contrapartida.
 */
export function baldeDeEmail(email: string): string {
  const normalizado = normalizarEmail(email);
  const hmac = createHmac('sha256', pepper(SALT_PEPPER_BALDE))
    .update(normalizado)
    .digest('hex');
  return `email:${hmac}`;
}

/** Salt determinístico do hash dummy — ver Argon2PasswordHasher. */
export function saltDoDummy(): Buffer {
  return scryptSync(passphraseAtual(), SALT_DUMMY, 16);
}

/**
 * Comparação de strings em tempo constante.
 *
 * Mesma forma do `safeEquals` de `domain/git/oauth-state.ts`: comprimento
 * diferente sai antes (o próprio comprimento não é segredo aqui), o resto vai
 * por `timingSafeEqual`.
 */
export function comparaEmTempoConstante(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
