import { describe, it, expect } from 'vitest';
import { EnvelopeEncryptionService } from '../../../src/infrastructure/security/envelope-encryption.service';

describe('EnvelopeEncryptionService', () => {
  it('caminho feliz: decrypt(encrypt(x)) retorna x', () => {
    const service = new EnvelopeEncryptionService();
    const secret = service.encrypt('sk-ant-super-secreta-123');
    expect(service.decrypt(secret)).toBe('sk-ant-super-secreta-123');
  });

  it('o envelope cifrado nunca contém o texto plano', () => {
    const service = new EnvelopeEncryptionService();
    const plaintext = 'sk-ant-super-secreta-123';
    const secret = service.encrypt(plaintext);
    const serialized = JSON.stringify(secret);
    expect(serialized).not.toContain(plaintext);
  });

  it('adulterar um byte do ciphertext falha ao decriptar (GCM detecta)', () => {
    const service = new EnvelopeEncryptionService();
    const secret = service.encrypt('sk-ant-super-secreta-123');

    const tamperedBuffer = Buffer.from(secret.encryptedApiKey, 'base64');
    tamperedBuffer[0] ^= 0xff;
    const tampered = {
      ...secret,
      encryptedApiKey: tamperedBuffer.toString('base64'),
    };

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('adulterar o authTag também falha ao decriptar', () => {
    const service = new EnvelopeEncryptionService();
    const secret = service.encrypt('sk-ant-super-secreta-123');

    const tamperedTag = Buffer.from(secret.apiKeyAuthTag, 'base64');
    tamperedTag[0] ^= 0xff;
    const tampered = {
      ...secret,
      apiKeyAuthTag: tamperedTag.toString('base64'),
    };

    expect(() => service.decrypt(tampered)).toThrow();
  });
});
