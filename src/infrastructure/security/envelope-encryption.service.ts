import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
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
 * 0059, RN-093, estendido pela RN-110): o `docker-compose.prod.yml` supria
 * este literal como fallback, então o caminho real de erro tinha a variável
 * DEFINIDA — "não vazia" não pegaria o defeito. A checagem aqui é só de
 * BOOT (ausente/exemplo/curta); não mexe no mecanismo de ROTAÇÃO, que
 * continua sendo `CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`.
 */
const PASSPHRASE_PADRAO = 'dev-master-key-change-me';
const TAMANHO_MINIMO = 16;

/**
 * Envelope encryption dos segredos do usuário (chaves de LLM e tokens de git).
 *
 * ## Rotação da chave mestra (Fase 5, item 3)
 *
 * O `wrapped_dek` gravado no banco NÃO carrega identificação de qual chave o
 * embrulhou. Isso é deliberado — um identificador de chave no registro é mais
 * um metadado a manter em sincronia — mas tem uma consequência direta: com uma
 * chave só, trocar `CREDENTIALS_MASTER_KEY` torna ilegível TODA credencial
 * existente, de uma vez, sem aviso e sem caminho de volta.
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
 * Ver docs/runbook.md (seção "Rotação da chave mestra").
 */
@Injectable()
export class EnvelopeEncryptionService implements EncryptionService {
  private readonly logger = new Logger(EnvelopeEncryptionService.name);
  private readonly masterKey: Buffer;
  private readonly previousKey: Buffer | null;

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

    if (this.previousKey) {
      // Visível de propósito: rodar por tempo indeterminado com duas chaves
      // aceitas dobra a superfície de uma chave vazada. O log é o lembrete de
      // que a rotação tem que TERMINAR.
      this.logger.warn(
        'CREDENTIALS_MASTER_KEY_PREVIOUS está definida — rotação em andamento. ' +
          'Rode `node scripts/rewrap-deks.js` e remova a variável ao terminar.',
      );
    }
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
   */
  rewrap(secret: EncryptedSecret): EncryptedSecret | null {
    let dek: Buffer;
    try {
      dek = this.unwrapDek(this.masterKey, secret);
      return null; // já está na chave atual
    } catch {
      if (!this.previousKey) {
        throw new Error(
          'registro não abre com a chave atual e CREDENTIALS_MASTER_KEY_PREVIOUS não está definida',
        );
      }
      dek = this.unwrapDek(this.previousKey, secret);
    }

    const dekIv = randomBytes(IV_LENGTH);
    const dekCipher = createCipheriv(ALGORITHM, this.masterKey, dekIv);
    const wrappedDek = Buffer.concat([
      dekCipher.update(dek),
      dekCipher.final(),
    ]);

    return {
      ...secret,
      wrappedDek: wrappedDek.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekAuthTag: dekCipher.getAuthTag().toString('base64'),
    };
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
