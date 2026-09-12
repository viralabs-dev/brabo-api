import { describe, it, expect, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
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
  const nodeEnvOriginal = process.env.NODE_ENV;

  afterEach(() => {
    delete process.env.CREDENTIALS_MASTER_KEY;
    delete process.env.CREDENTIALS_MASTER_KEY_PREVIOUS;
    if (nodeEnvOriginal === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnvOriginal;
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

  /**
   * O `key_id` no envelope (ADR 0158, RN-563).
   *
   * As chaves aqui nascem de `randomBytes` a cada rodada — nada com cara de
   * segredo vai para o histórico do git, e o gitleaks varre branches.
   */
  describe('key_id da chave mestra', () => {
    const passphrase = () => randomBytes(24).toString('hex');
    const segredo = () => `sk-${randomBytes(16).toString('hex')}`;

    it('caminho feliz: encrypt grava a impressão digital da chave atual, e ela é estável', () => {
      const k = passphrase();
      const a = comChaves(k);
      const b = comChaves(k);

      const envelopeA = a.encrypt(segredo());
      expect(envelopeA.keyId).toBe(a.keyId);
      // Determinística: a MESMA passphrase produz a MESMA impressão em outra
      // instância, que é o que torna a consulta do runbook possível.
      expect(b.keyId).toBe(a.keyId);
      expect(a.keyId).toMatch(/^[0-9a-f]{16}$/);
    });

    it('chaves diferentes produzem impressões diferentes', () => {
      expect(comChaves(passphrase()).keyId).not.toBe(
        comChaves(passphrase()).keyId,
      );
    });

    it('a impressão não é a passphrase nem um hash dela', () => {
      const k = passphrase();
      const service = comChaves(k);
      expect(service.keyId).not.toContain(k);
      // Não é `sha256(passphrase)`: passa pelo scrypt e por um HMAC com rótulo
      // de domínio, então quem lê o banco não reconhece a chave por comparação
      // com um hash barato.
      expect(service.keyId).not.toBe(
        createHash('sha256').update(k).digest('hex').slice(0, 16),
      );
    });

    it('rewrap carimba a impressão da chave NOVA', () => {
      const k1 = passphrase();
      const k2 = passphrase();
      const antigo = comChaves(k1).encrypt(segredo());

      const durante = comChaves(k2, k1);
      const novo = durante.rewrap(antigo);

      expect(antigo.keyId).not.toBe(durante.keyId);
      expect(novo!.keyId).toBe(durante.keyId);
    });

    it('registro SEM key_id (linha legada) é re-embrulhado normalmente e ganha o rótulo', () => {
      const k1 = passphrase();
      const k2 = passphrase();
      const texto = segredo();
      const { keyId: _descartado, ...legado } = comChaves(k1).encrypt(texto);

      const durante = comChaves(k2, k1);
      const novo = durante.rewrap(legado);

      expect(novo!.keyId).toBe(durante.keyId);
      expect(comChaves(k2).decrypt(novo!)).toBe(texto);
    });

    /**
     * O invariante central do ADR 0158: o rótulo é OBSERVABILIDADE, e o GCM
     * continua sendo a AUTORIDADE.
     *
     * Se `rewrap` acreditasse no rótulo, esta linha — que MENTE dizendo estar
     * na chave atual — seria pulada em silêncio, não entraria na contagem de
     * re-embrulhados, e o passo 3 do runbook (descartar a chave velha) a
     * tornaria ilegível para sempre.
     */
    it('rótulo mentindo "estou na chave atual" NÃO faz o rewrap pular o registro', () => {
      const k1 = passphrase();
      const k2 = passphrase();
      const texto = segredo();

      const durante = comChaves(k2, k1);
      const mentiroso = {
        ...comChaves(k1).encrypt(texto),
        keyId: durante.keyId,
      };

      const novo = durante.rewrap(mentiroso);
      expect(novo).not.toBeNull();
      expect(comChaves(k2).decrypt(novo!)).toBe(texto);
    });

    it('caso de falha: quando nenhuma chave abre, a mensagem NOMEIA a chave do registro sem vazar segredo', () => {
      const k1 = passphrase();
      const k2 = passphrase();
      const outroAmbiente = passphrase();
      const texto = segredo();

      const forasteiro = comChaves(outroAmbiente);
      const envelopeAlheio = forasteiro.encrypt(texto);

      const durante = comChaves(k2, k1);
      let mensagem = '';
      try {
        durante.rewrap(envelopeAlheio);
      } catch (erro) {
        mensagem = (erro as Error).message;
      }

      expect(mensagem).toContain('NENHUMA das duas chaves');
      expect(mensagem).toContain(forasteiro.keyId);
      expect(mensagem).toContain('outro ambiente');
      // Nem a passphrase nem o segredo aparecem em lugar nenhum da mensagem.
      for (const proibido of [k1, k2, outroAmbiente, texto]) {
        expect(mensagem).not.toContain(proibido);
      }
    });

    it('caso de falha: registro sem key_id que não abre é dito como "sem rótulo", não como "outro ambiente"', () => {
      const k1 = passphrase();
      const k2 = passphrase();
      const { keyId: _semRotulo, ...alheio } =
        comChaves(passphrase()).encrypt(segredo());

      expect(() => comChaves(k2, k1).rewrap(alheio)).toThrow(/não tem key_id/i);
    });
  });

  /**
   * `CREDENTIALS_MASTER_KEY` sem default em produção (RN-114, mesmo padrão do
   * `GIT_OAUTH_STATE_SECRET` — ADR 0059/RN-093). Mesma observação dos outros
   * dois specs desta família: o caso que interessa não é o feliz, é o de
   * subir produção sem configurar — e o caso central é a chave DEFINIDA com o
   * valor de exemplo, porque era esse o caminho real de erro com o
   * `docker-compose.prod.yml` suprindo o literal como fallback.
   *
   * Fica FORA de escopo aqui qualquer mecanismo de rotação — esse já existe
   * (`CREDENTIALS_MASTER_KEY_PREVIOUS` + `rewrap-deks.ts`) e está coberto
   * acima; esta checagem é só de BOOT.
   */
  describe('validação de produção', () => {
    it('caminho feliz: em produção, constrói com a chave configurada', () => {
      process.env.NODE_ENV = 'production';
      process.env.CREDENTIALS_MASTER_KEY = 'chave-de-teste-nao-e-segredo';
      expect(() => new EnvelopeEncryptionService()).not.toThrow();
    });

    it('em produção, a chave de EXEMPLO do repositório derruba o boot', () => {
      process.env.NODE_ENV = 'production';
      process.env.CREDENTIALS_MASTER_KEY = 'dev-master-key-change-me';
      expect(() => new EnvelopeEncryptionService()).toThrow(
        /valor de exemplo/i,
      );
    });

    it('em produção, sem a variável, derruba o boot', () => {
      process.env.NODE_ENV = 'production';
      expect(() => new EnvelopeEncryptionService()).toThrow(
        /obrigatória em produção/i,
      );
    });

    it('em produção, chave curta derruba o boot', () => {
      process.env.NODE_ENV = 'production';
      process.env.CREDENTIALS_MASTER_KEY = 'senha123';
      expect(() => new EnvelopeEncryptionService()).toThrow(
        /mínimo em produção/i,
      );
    });

    it('em produção, espaço em volta não conta como chave', () => {
      process.env.NODE_ENV = 'production';
      process.env.CREDENTIALS_MASTER_KEY = '   ';
      expect(() => new EnvelopeEncryptionService()).toThrow(
        /obrigatória em produção/i,
      );
    });

    it('fora de produção, sem a variável, cai no default de desenvolvimento', () => {
      process.env.NODE_ENV = 'development';
      // O default de dev não derruba nada, e continua interoperando com
      // decrypt() de uma instância construída com o mesmo default implícito.
      const semVar = new EnvelopeEncryptionService();
      const secret = semVar.encrypt('sk-ant-super-secreta-123');
      expect(semVar.decrypt(secret)).toBe('sk-ant-super-secreta-123');
    });

    it('fora de produção, chave curta é aceita', () => {
      process.env.NODE_ENV = 'development';
      process.env.CREDENTIALS_MASTER_KEY = 'curta';
      expect(() => new EnvelopeEncryptionService()).not.toThrow();
    });
  });
});
