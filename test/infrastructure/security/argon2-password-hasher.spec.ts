import { describe, it, expect, beforeAll } from 'vitest';
import {
  Argon2PasswordHasher,
  PARAMS,
  parametrosDoHash,
} from '../../../src/infrastructure/security/argon2-password-hasher';

const hasher = new Argon2PasswordHasher();

beforeAll(async () => {
  await hasher.onModuleInit();
}, 30_000);

describe('Argon2PasswordHasher', () => {
  it('caminho feliz: verifica a senha que gerou o hash', async () => {
    const encoded = await hasher.hash('uma-senha-bem-comprida-123');
    expect(await hasher.verify(encoded, 'uma-senha-bem-comprida-123')).toBe(
      true,
    );
  });

  it('recusa senha errada', async () => {
    const encoded = await hasher.hash('uma-senha-bem-comprida-123');
    expect(await hasher.verify(encoded, 'uma-senha-bem-comprida-124')).toBe(
      false,
    );
  });

  it('hash malformado devolve false em vez de lançar', async () => {
    // Se lançasse, o ramo de e-mail inexistente do login (que verifica contra
    // o dummy) viraria 500 — um oráculo mais barulhento do que o que se
    // quer fechar.
    expect(await hasher.verify('não é um hash', 'qualquer')).toBe(false);
  });

  it('o mesmo texto gera hashes diferentes (salt por registro)', async () => {
    const a = await hasher.hash('mesma-senha-para-os-dois');
    const b = await hasher.hash('mesma-senha-para-os-dois');
    expect(a).not.toEqual(b);
  });

  it('usa argon2id, não argon2i nem argon2d', async () => {
    const encoded = await hasher.hash('uma-senha-bem-comprida-123');
    expect(encoded.startsWith('$argon2id$')).toBe(true);
  });

  describe('o hash dummy', () => {
    it('tem EXATAMENTE os mesmos parâmetros do hash real', () => {
      // Esta é a asserção que impede a mitigação de virar a vulnerabilidade.
      // Um dummy mais barato responde em ~2ms contra os ~50ms do hash real, e
      // o ramo de e-mail inexistente passa a ser identificável pelo relógio —
      // exatamente o oráculo que o dummy existe para fechar, invertido.
      expect(parametrosDoHash(hasher.dummyHash)).toEqual(PARAMS);
    });

    it('é verificável (a ligação nativa abre o próprio dummy)', async () => {
      expect(await hasher.verify(hasher.dummyHash, 'senha-qualquer')).toBe(
        false,
      );
    });

    it('é estável entre instâncias — mesmo salt determinístico', async () => {
      const outro = new Argon2PasswordHasher();
      await outro.onModuleInit();
      expect(outro.dummyHash).toEqual(hasher.dummyHash);
    }, 30_000);
  });
});
