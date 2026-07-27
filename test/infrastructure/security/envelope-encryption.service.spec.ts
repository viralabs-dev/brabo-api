import { describe, it, expect, afterEach } from 'vitest';
import { EnvelopeEncryptionService } from '../../../src/infrastructure/security/envelope-encryption.service';

/** Instancia o serviço com um par de chaves explícito, isolando o ambiente. */
function comChaves(
  atual: string,
  anterior?: string,
): EnvelopeEncryptionService {
  process.env.CREDENTIALS_MASTER_KEY = atual;
  if (anterior === undefined)
    delete process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
  else process.env.CREDENTIALS_MASTER_KEY_PREVIOUS = anterior;
  return new EnvelopeEncryptionService();
}

describe('EnvelopeEncryptionService', () => {
  afterEach(() => {
    delete process.env.CREDENTIALS_MASTER_KEY;
    delete process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
  });

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

  /**
   * Rotação da chave mestra (Fase 5, item 3).
   *
   * O que estes testes protegem é a única propriedade que torna a rotação
   * possível SEM downtime: durante a janela em que as duas chaves coexistem,
   * um segredo embrulhado pela chave velha continua legível, e o re-embrulho
   * troca o envelope sem tocar no conteúdo.
   */
  describe('rotação da chave mestra', () => {
    it('caminho feliz: segredo da chave antiga continua legível com a nova publicada', () => {
      const antes = comChaves('chave-antiga');
      const secret = antes.encrypt('ghp_token_do_usuario');

      // Rotação começou: nova é a atual, antiga vira a de fallback.
      const durante = comChaves('chave-nova', 'chave-antiga');
      expect(durante.decrypt(secret)).toBe('ghp_token_do_usuario');
    });

    it('re-embrulha na chave nova SEM alterar o conteúdo cifrado', () => {
      const antes = comChaves('chave-antiga');
      const secret = antes.encrypt('ghp_token_do_usuario');

      const durante = comChaves('chave-nova', 'chave-antiga');
      const reembrulhado = durante.rewrap(secret);

      expect(reembrulhado).not.toBeNull();
      // O envelope mudou...
      expect(reembrulhado!.wrappedDek).not.toBe(secret.wrappedDek);
      // ...e o texto cifrado do segredo NÃO. É isto que permite parar o script
      // no meio sem deixar o acervo inconsistente.
      expect(reembrulhado!.encryptedApiKey).toBe(secret.encryptedApiKey);
      expect(reembrulhado!.apiKeyIv).toBe(secret.apiKeyIv);
      expect(reembrulhado!.apiKeyAuthTag).toBe(secret.apiKeyAuthTag);

      // E o resultado abre só com a chave nova, sem precisar da antiga.
      const depois = comChaves('chave-nova');
      expect(depois.decrypt(reembrulhado!)).toBe('ghp_token_do_usuario');
    });

    it('rewrap devolve null quando o registro já está na chave atual (idempotência)', () => {
      const service = comChaves('chave-nova', 'chave-antiga');
      const secret = service.encrypt('ghp_token_do_usuario');
      expect(service.rewrap(secret)).toBeNull();
    });

    it('falha quando NENHUMA das duas chaves serve', () => {
      const outro = comChaves('chave-de-outro-ambiente');
      const secret = outro.encrypt('ghp_token_do_usuario');

      const service = comChaves('chave-nova', 'chave-antiga');
      expect(() => service.decrypt(secret)).toThrow();
      expect(() => service.rewrap(secret)).toThrow();
    });

    it('sem a chave anterior publicada, o segredo antigo fica ilegível', () => {
      // A regressão que justifica a variável PREVIOUS existir: trocar a chave
      // mestra sem ela torna TODA credencial existente inacessível de uma vez.
      const antes = comChaves('chave-antiga');
      const secret = antes.encrypt('ghp_token_do_usuario');

      const semFallback = comChaves('chave-nova');
      expect(() => semFallback.decrypt(secret)).toThrow();
    });
  });
});
