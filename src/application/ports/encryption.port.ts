export interface EncryptedSecret {
  wrappedDek: string;
  dekIv: string;
  dekAuthTag: string;
  encryptedApiKey: string;
  apiKeyIv: string;
  apiKeyAuthTag: string;
}

export abstract class EncryptionService {
  abstract encrypt(plaintext: string): EncryptedSecret;
  abstract decrypt(secret: EncryptedSecret): string;
}
