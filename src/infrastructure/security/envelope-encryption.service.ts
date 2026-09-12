import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  EncryptionService,
  type EncryptedSecret,
} from '../../application/ports/encryption.port';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DEK_LENGTH = 32;
const SALT = 'brabo-credentials-salt';

/**
 * Default de DESENVOLVIMENTO, público neste repositório (`.env.example`).
 *
 * Recusado em produção pelo mesmo motivo do `GIT_OAUTH_STATE_SECRET` (ADR
 * 0059, RN-093, estendido pela RN-114): o `docker-compose.prod.yml` supria
 * este literal como fallback, então o caminho real de erro tinha a variável
 * DEFINIDA — "não vazia" não pegaria o defeito. A checagem aqui é só de
 * BOOT (ausente/exemplo/curta); não mexe no mecanismo de ROTAÇÃO, que
 * continua sendo `CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`.
 */
const PASSPHRASE_PADRAO = 'dev-master-key-change-me';
const TAMANHO_MINIMO = 16;

/**
 * Separação de domínio da impressão digital da chave (ADR 0158). Constante e
 * pública: o que a torna irreversível é o HMAC, nunca este rótulo ser secreto.
 */
const ROTULO_DA_IMPRESSAO = 'brabo-master-key-id';
const TAMANHO_DA_IMPRESSAO = 16; // hex, 8 bytes

/**
 * Envelope encryption dos segredos do usuário (chaves de LLM e tokens de git).
 *
 * ## Rotação da chave mestra (Fase 5, item 3)
 *
 * Trocar `CREDENTIALS_MASTER_KEY` com uma chave só torna ilegível TODA
 * credencial existente, de uma vez, sem aviso e sem caminho de volta.
 *
 * Daí `CREDENTIALS_MASTER_KEY_PREVIOUS`: durante a rotação as duas chaves
 * coexistem, o `decrypt` tenta a atual e cai para a anterior, e o
 * `src/scripts/rewrap-deks.ts` re-embrulha o acervo em segundo plano. Quando o
 * script termina, a variável anterior é removida. Sem downtime e sem janela em
 * que uma credencial fique inacessível.
 *
 * O `encrypt` usa SEMPRE a chave atual: o que se rotaciona é o embrulho, e um
 * segredo novo já nasce na chave nova.
 *
 * ## O `keyId`, e por que ele NÃO decide nada (ADR 0158, RN-563)
 *
 * Desde a RN-563 o envelope carrega a IMPRESSÃO DIGITAL da chave que o
 * embrulhou — `HMAC-SHA256(chave derivada, rótulo)` truncado. Ela existe para
 * responder em SQL *"quantas credenciais ainda estão na chave anterior?"*, que
 * é o passo 2 do runbook, e para dar diagnóstico DIFERENTE a "veio de outro
 * ambiente" e a "registro adulterado".
 *
 * O que ela NÃO faz, de propósito: escolher a chave. `decrypt` continua
 * tentando a atual e caindo para a anterior, e `rewrap` continua decidindo
 * "já está na chave atual" pela TENTATIVA. Usar o rótulo como autoridade
 * faria uma linha rotulada "atual" cujo envelope está na chave velha ser
 * PULADA em silêncio pelo re-embrulho — e o passo 3, que descarta a chave
 * velha, a tornaria ilegível para sempre. O rótulo é metadado; o envelope é
 * a verdade.
 *
 * `keyId` ausente/nulo é a linha gravada antes desta coluna existir. Nunca é
 * lido como "está na chave atual".
 *
 * Ver docs/runbook.md (seção "Rotação da chave mestra").
 */
@Injectable()
export class EnvelopeEncryptionService implements EncryptionService {
  private readonly logger = new Logger(EnvelopeEncryptionService.name);
  private readonly masterKey: Buffer;
  private readonly previousKey: Buffer | null;
  /** Impressão digital da chave ATUAL — o valor gravado em toda escrita. */
  readonly keyId: string;
  /** Impressão digital da anterior, quando publicada. */
  readonly previousKeyId: string | null;

  constructor() {
    // Aceita qualquer tamanho de passphrase (não exige exatos 32 bytes);
    // deriva uma chave AES-256 válida via scrypt.
    const passphrase = EnvelopeEncryptionService.resolveMasterKeyPassphrase();
    this.masterKey = scryptSync(passphrase, SALT, 32);

    const previous = process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
    this.previousKey =
      previous && previous !== passphrase
        ? scryptSync(previous, SALT, 32)
        : null;

    this.keyId = EnvelopeEncryptionService.impressaoDigital(this.masterKey);
    this.previousKeyId = this.previousKey
      ? EnvelopeEncryptionService.impressaoDigital(this.previousKey)
      : null;

    // O operador precisa da impressão digital corrente para a consulta de
    // progresso do runbook — uma coluna que ninguém consegue comparar contra
    // nada é inútil. Sair em log não barateia tentativa nenhuma: ver ADR 0158.
    this.logger.log(`chave mestra corrente: key_id=${this.keyId}`);

    if (this.previousKey) {
      // Visível de propósito: rodar por tempo indeterminado com duas chaves
      // aceitas dobra a superfície de uma chave vazada. O log é o lembrete de
      // que a rotação tem que TERMINAR.
      this.logger.warn(
        'CREDENTIALS_MASTER_KEY_PREVIOUS está definida — rotação em andamento ' +
          `(atual key_id=${this.keyId}, anterior key_id=${this.previousKeyId}). ` +
          'Rode `node scripts/rewrap-deks.js` e remova a variável ao terminar.',
      );
    }
  }

  /**
   * Identifica a chave sem revelá-la, e sem criar oráculo novo (ADR 0158).
   *
   * HMAC da chave DERIVADA, com rótulo de domínio, truncado a 8 bytes. Quem lê
   * o banco já podia testar uma passphrase candidata contra o próprio envelope
   * — GCM autentica —, pagando um `scrypt` por tentativa; testá-la contra esta
   * impressão custa o MESMO `scrypt`. Não é hash da passphrase, não é derivado
   * reversível, e não é um valor que o operador digite em lugar nenhum.
   */
  private static impressaoDigital(key: Buffer): string {
    return createHmac('sha256', key)
      .update(ROTULO_DA_IMPRESSAO)
      .digest('hex')
      .slice(0, TAMANHO_DA_IMPRESSAO);
  }

  /**
   * Resolve a passphrase da chave mestra, com a mesma regra de
   * `resolveOauthStateSecret()`: fora de produção o default de
   * desenvolvimento vale; em produção a variável é obrigatória, o literal de
   * exemplo é recusado mesmo definido explicitamente, e há um piso de 16
   * caracteres.
   */
  private static resolveMasterKeyPassphrase(): string {
    const producao = process.env.NODE_ENV === 'production';
    const bruto = (process.env.CREDENTIALS_MASTER_KEY ?? '').trim();

    if (!producao) {
      return bruto || PASSPHRASE_PADRAO;
    }

    if (!bruto) {
      throw new Error(
        'CREDENTIALS_MASTER_KEY é obrigatória em produção — ela embrulha os ' +
          'DEKs que cifram as credenciais do usuário, e o default de ' +
          'desenvolvimento é público neste repositório.',
      );
    }

    if (bruto === PASSPHRASE_PADRAO) {
      throw new Error(
        'CREDENTIALS_MASTER_KEY está com o valor de exemplo do repositório, ' +
          'que é público — em produção isso equivale a não cifrar credencial ' +
          'nenhuma. Gere uma própria (ex.: `openssl rand -base64 32`).',
      );
    }

    if (bruto.length < TAMANHO_MINIMO) {
      throw new Error(
        `CREDENTIALS_MASTER_KEY tem ${bruto.length} caracteres; o mínimo em ` +
          `produção é ${TAMANHO_MINIMO}. Gere uma aleatória (ex.: ` +
          '`openssl rand -base64 32`).',
      );
    }

    return bruto;
  }

  encrypt(plaintext: string): EncryptedSecret {
    return this.encryptWith(this.masterKey, plaintext);
  }

  decrypt(secret: EncryptedSecret): string {
    try {
      return this.decryptWith(this.masterKey, secret);
    } catch (error) {
      if (!this.previousKey) throw error;
      // A chave anterior só é tentada quando a atual falha. GCM autentica, então
      // "falhou" aqui significa tag inválida — ou seja, embrulhado por outra
      // chave — e não um plaintext errado passando despercebido.
      return this.decryptWith(this.previousKey, secret);
    }
  }

  /**
   * Re-embrulha um segredo na chave ATUAL sem tocar no texto cifrado do
   * conteúdo — o DEK é o mesmo, só o envelope muda.
   *
   * Usado pelo script de rotação. Devolve `null` quando o registro já está na
   * chave atual, o que é o que torna o script idempotente e permite rodá-lo
   * várias vezes sem reescrever o acervo inteiro toda vez.
   *
   * Quem decide "já está na chave atual" é a TENTATIVA, e não o `keyId` — ver
   * o docblock da classe. O `keyId` entra só quando NADA abre, para dizer POR
   * QUE (ADR 0158, RN-563).
   */
  rewrap(secret: EncryptedSecret): EncryptedSecret | null {
    let dek: Buffer;
    try {
      dek = this.unwrapDek(this.masterKey, secret);
      return null; // já está na chave atual
    } catch {
      if (!this.previousKey) {
        throw new Error(
          'registro não abre com a chave atual e CREDENTIALS_MASTER_KEY_PREVIOUS ' +
            `não está definida — ${this.diagnosticoDaChave(secret)}`,
        );
      }
      try {
        dek = this.unwrapDek(this.previousKey, secret);
      } catch {
        // A falha genérica do GCM não distingue "chave errada" de "blob
        // corrompido", e as duas pedem ações opostas. Com o rótulo, dá para
        // nomear o caso.
        throw new Error(
          `registro não abre com NENHUMA das duas chaves — ${this.diagnosticoDaChave(secret)}`,
        );
      }
    }

    const dekIv = randomBytes(IV_LENGTH);
    const dekCipher = createCipheriv(ALGORITHM, this.masterKey, dekIv);
    const wrappedDek = Buffer.concat([
      dekCipher.update(dek),
      dekCipher.final(),
    ]);

    return {
      ...secret,
      keyId: this.keyId,
      wrappedDek: wrappedDek.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekAuthTag: dekCipher.getAuthTag().toString('base64'),
    };
  }

  /**
   * Diz o que o rótulo do registro permite dizer, e só isso. Nunca inclui
   * material de chave nem conteúdo do segredo — só impressões digitais.
   */
  private diagnosticoDaChave(secret: EncryptedSecret): string {
    const doRegistro = secret.keyId ?? null;
    if (doRegistro === null) {
      return 'o registro não tem key_id (gravado antes da RN-563), então não há como dizer qual chave o embrulhou';
    }
    if (doRegistro === this.keyId) {
      return (
        `o key_id do registro (${doRegistro}) diz que ele está na chave ATUAL e mesmo ` +
        'assim o envelope não abre com ela: rótulo incoerente ou registro adulterado'
      );
    }
    if (this.previousKeyId !== null && doRegistro === this.previousKeyId) {
      return (
        `o key_id do registro (${doRegistro}) é o da chave anterior publicada e mesmo ` +
        'assim o envelope não abre com ela: registro adulterado'
      );
    }
    const anterior = this.previousKeyId ?? 'nenhuma publicada';
    return (
      `o registro foi embrulhado pela chave ${doRegistro}, que não é a atual ` +
      `(${this.keyId}) nem a anterior (${anterior}) — provavelmente veio de outro ambiente`
    );
  }

  private encryptWith(key: Buffer, plaintext: string): EncryptedSecret {
    const dek = randomBytes(DEK_LENGTH);

    const apiKeyIv = randomBytes(IV_LENGTH);
    const apiKeyCipher = createCipheriv(ALGORITHM, dek, apiKeyIv);
    const encryptedApiKey = Buffer.concat([
      apiKeyCipher.update(plaintext, 'utf8'),
      apiKeyCipher.final(),
    ]);
    const apiKeyAuthTag = apiKeyCipher.getAuthTag();

    const dekIv = randomBytes(IV_LENGTH);
    const dekCipher = createCipheriv(ALGORITHM, key, dekIv);
    const wrappedDek = Buffer.concat([
      dekCipher.update(dek),
      dekCipher.final(),
    ]);
    const dekAuthTag = dekCipher.getAuthTag();

    return {
      // `encryptWith` só é chamado com a chave ATUAL (`encrypt`), então o
      // rótulo é o dela. Segredo novo nasce sempre na chave nova.
      keyId: this.keyId,
      wrappedDek: wrappedDek.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekAuthTag: dekAuthTag.toString('base64'),
      encryptedApiKey: encryptedApiKey.toString('base64'),
      apiKeyIv: apiKeyIv.toString('base64'),
      apiKeyAuthTag: apiKeyAuthTag.toString('base64'),
    };
  }

  private unwrapDek(key: Buffer, secret: EncryptedSecret): Buffer {
    const dekDecipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(secret.dekIv, 'base64'),
    );
    dekDecipher.setAuthTag(Buffer.from(secret.dekAuthTag, 'base64'));
    return Buffer.concat([
      dekDecipher.update(Buffer.from(secret.wrappedDek, 'base64')),
      dekDecipher.final(),
    ]);
  }

  private decryptWith(key: Buffer, secret: EncryptedSecret): string {
    const dek = this.unwrapDek(key, secret);

    const apiKeyDecipher = createDecipheriv(
      ALGORITHM,
      dek,
      Buffer.from(secret.apiKeyIv, 'base64'),
    );
    apiKeyDecipher.setAuthTag(Buffer.from(secret.apiKeyAuthTag, 'base64'));
    const plaintext = Buffer.concat([
      apiKeyDecipher.update(Buffer.from(secret.encryptedApiKey, 'base64')),
      apiKeyDecipher.final(),
    ]);

    return plaintext.toString('utf8');
  }
}
