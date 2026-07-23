import { Injectable } from '@nestjs/common';
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

@Injectable()
export class EnvelopeEncryptionService implements EncryptionService {
  private readonly masterKey: Buffer;

  constructor() {
    // Aceita qualquer tamanho de passphrase (não exige exatos 32 bytes);
    // deriva uma chave AES-256 válida via scrypt — mesmo estilo `?? default`
    // usado no resto do código pra variáveis de ambiente.
    const passphrase =
      process.env.CREDENTIALS_MASTER_KEY ?? 'dev-master-key-change-me';
    this.masterKey = scryptSync(passphrase, 'brabo-credentials-salt', 32);
  }

  encrypt(plaintext: string): EncryptedSecret {
    const dek = randomBytes(DEK_LENGTH);

    const apiKeyIv = randomBytes(IV_LENGTH);
    const apiKeyCipher = createCipheriv(ALGORITHM, dek, apiKeyIv);
    const encryptedApiKey = Buffer.concat([
      apiKeyCipher.update(plaintext, 'utf8'),
      apiKeyCipher.final(),
    ]);
    const apiKeyAuthTag = apiKeyCipher.getAuthTag();

    const dekIv = randomBytes(IV_LENGTH);
    const dekCipher = createCipheriv(ALGORITHM, this.masterKey, dekIv);
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

  decrypt(secret: EncryptedSecret): string {
    const dekDecipher = createDecipheriv(
      ALGORITHM,
      this.masterKey,
      Buffer.from(secret.dekIv, 'base64'),
    );
    dekDecipher.setAuthTag(Buffer.from(secret.dekAuthTag, 'base64'));
    const dek = Buffer.concat([
      dekDecipher.update(Buffer.from(secret.wrappedDek, 'base64')),
      dekDecipher.final(),
    ]);

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
