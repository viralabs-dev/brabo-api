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
 * Ver docs/runbooks/rotacao-chave-mestra.md.
 */
@Injectable()
export class EnvelopeEncryptionService implements EncryptionService {
  private readonly logger = new Logger(EnvelopeEncryptionService.name);
  private readonly masterKey: Buffer;
  private readonly previousKey: Buffer | null;

  constructor() {
    // Aceita qualquer tamanho de passphrase (não exige exatos 32 bytes);
    // deriva uma chave AES-256 válida via scrypt — mesmo estilo `?? default`
    // usado no resto do código pra variáveis de ambiente.
    const passphrase =
      process.env.CREDENTIALS_MASTER_KEY ?? 'dev-master-key-change-me';
    this.masterKey = scryptSync(passphrase, SALT, 32);

    const previous = process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
    this.previousKey =
      previous && previous !== passphrase ? scryptSync(previous, SALT, 32) : null;

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
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);

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
    const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
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
