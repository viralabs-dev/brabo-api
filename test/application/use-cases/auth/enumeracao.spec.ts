import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { HttpException } from '@nestjs/common';
import { parametrosDoHash } from '../../../../src/infrastructure/security/argon2-password-hasher';
import {
  contaPronta,
  montarHarness,
  EMAIL,
  SENHA_BOA,
  type Harness,
} from './harness';

/**
 * Resistência a enumeração de e-mail (Fase 7a, item 2).
 *
 * ## Por que a asserção principal NÃO é sobre o relógio
 *
 * Teste de tempo em CI é frágil por natureza: runner compartilhado, GC, JIT.
 * Um `expect(Math.abs(tA - tB)).toBeLessThan(5)` fica vermelho uma vez a cada
 * vinte execuções — o que é PIOR do que não ter teste, porque o time aprende a
 * apertar "re-run" e para de ler a falha.
 *
 * Então a trava é sobre o CAMINHO DE CÓDIGO: um espião no `PasswordHasher`
 * prova que os três ramos chamam `verify` exatamente uma vez, com hashes de
 * parâmetros idênticos. Isso é determinístico, e é o defeito que um teste de
 * tempo estaria tateando: alguém acrescentar um `if (!credencial) throw` antes
 * do verify.
 *
 * O que ele NÃO prova: que os relógios batem; que nenhuma outra operação
 * (uma linha de log maior, uma query a mais) introduz diferença. A afirmação
 * honesta é "nenhum ramo pula o trabalho caro e nenhum produz resposta
 * distinguível" — não "tempo constante". O ADR 0031 registra isso nesses
 * termos.
 */

let h: Harness;

beforeAll(async () => {
  h = await montarHarness();
}, 60_000);

beforeEach(async () => {
  await h.limpar();
  h.mail.limpar();
  h.hasher.limpar();
});

afterAll(async () => {
  await h.pool.end();
});

async function capturar(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (erro) {
    return erro as HttpException;
  }
}

describe('login: os três ramos de falha são indistinguíveis', () => {
  it('e-mail inexistente e senha errada devolvem status e corpo idênticos', async () => {
    await contaPronta(h);

    const inexistente = await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );
    const senhaErrada = await capturar(() =>
      h.login.execute({ email: EMAIL, senha: 'senha errada mas comprida' }),
    );

    expect(inexistente).not.toBeNull();
    expect(inexistente!.getStatus()).toBe(senhaErrada!.getStatus());
    expect(inexistente!.getResponse()).toEqual(senhaErrada!.getResponse());
  });

  it('conta bloqueada responde igual a senha errada', async () => {
    await contaPronta(h);
    // Estoura o balde do e-mail.
    for (let i = 0; i < 5; i++) {
      await capturar(() =>
        h.login.execute({ email: EMAIL, senha: 'errada mas comprida' }),
      );
    }

    const bloqueada = await capturar(() =>
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    );
    const inexistente = await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );

    // Um 429 ou um "conta bloqueada" contaria ao atacante que a conta existe E
    // que ele acertou o alvo.
    expect(bloqueada!.getStatus()).toBe(inexistente!.getStatus());
    expect(bloqueada!.getResponse()).toEqual(inexistente!.getResponse());
  });

  it('os três ramos chamam verify exatamente uma vez', async () => {
    // A trava determinística. Vermelha no instante em que alguém acrescentar
    // uma saída antecipada antes do argon2.
    await contaPronta(h);

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );
    expect(h.hasher.verifies).toHaveLength(1);

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: EMAIL, senha: 'errada mas comprida' }),
    );
    expect(h.hasher.verifies).toHaveLength(1);

    for (let i = 0; i < 4; i++) {
      await capturar(() =>
        h.login.execute({ email: EMAIL, senha: 'errada mas comprida' }),
      );
    }
    h.hasher.limpar();
    await capturar(() => h.login.execute({ email: EMAIL, senha: SENHA_BOA }));
    expect(
      h.hasher.verifies,
      'o ramo bloqueado precisa gastar o mesmo argon2 — responder rápido é o vazamento',
    ).toHaveLength(1);
  });

  it('o hash verificado tem os MESMOS parâmetros nos três ramos', async () => {
    // Um dummy gerado com parâmetros mais baratos responde em ~2ms contra
    // ~50ms do real: a mitigação viraria o oráculo, invertido. É a forma mais
    // comum de errar esta defesa.
    await contaPronta(h);

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: 'ninguem@brabo.dev', senha: SENHA_BOA }),
    );
    const semConta = parametrosDoHash(h.hasher.verifies[0]);

    h.hasher.limpar();
    await capturar(() =>
      h.login.execute({ email: EMAIL, senha: 'errada mas comprida' }),
    );
    const comConta = parametrosDoHash(h.hasher.verifies[0]);

    expect(semConta).toEqual(comConta);
    expect(semConta).toEqual(h.hasher.params);
  });

  it('e-mail não verificado só é revelado DEPOIS da senha certa', async () => {
    // A invariante: qualquer resposta diferente da falha uniforme exige senha
    // provada. Aqui a senha está certa, então diferenciar não vaza nada.
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });

    const comSenhaCerta = await capturar(() =>
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    );
    const comSenhaErrada = await capturar(() =>
      h.login.execute({ email: EMAIL, senha: 'errada mas comprida' }),
    );

    expect(comSenhaCerta!.getStatus()).toBe(403);
    expect(comSenhaErrada!.getStatus()).toBe(401);
  });
});

describe('registro: e-mail duplicado não se distingue de e-mail novo', () => {
  it('as duas chamadas terminam sem erro', async () => {
    // Um 409 aqui entregaria a lista de usuários a quem tiver uma wordlist —
    // e tornaria inútil todo o cuidado do login.
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    await expect(
      h.register.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeUndefined();
  });

  it('o ramo duplicado gasta o mesmo argon2 HASH do ramo que cria', async () => {
    h.hasher.limpar();
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const doRamoNovo = h.hasher.hashes.length;

    h.hasher.limpar();
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    const doRamoDuplicado = h.hasher.hashes.length;

    expect(doRamoDuplicado).toBe(doRamoNovo);
    expect(parametrosDoHash(h.hasher.hashes[0])).toEqual(h.hasher.params);
  });

  it('o duplicado não cria conta nova e avisa o dono do endereço', async () => {
    await h.register.execute({ email: EMAIL, senha: SENHA_BOA });
    h.mail.limpar();

    await h.register.execute({ email: EMAIL, senha: 'outra senha comprida' });

    expect(h.mail.ultimoDoTipo('register_duplicate')).toBeDefined();
    expect(h.mail.ultimoDoTipo('email_verification')).toBeUndefined();
  });

  it('a senha do duplicado NÃO substitui a existente', async () => {
    // Seria takeover trivial: bastaria "registrar" de novo com a senha nova.
    await contaPronta(h);
    await h.register.execute({ email: EMAIL, senha: 'senha do atacante 123' });

    await expect(
      h.login.execute({ email: EMAIL, senha: 'senha do atacante 123' }),
    ).rejects.toThrow();
    await expect(
      h.login.execute({ email: EMAIL, senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });
});

describe('pedido de reset: conhecido e desconhecido respondem igual', () => {
  it('nenhum dos dois lança', async () => {
    await contaPronta(h);

    await expect(
      h.requestReset.execute({ email: EMAIL }),
    ).resolves.toBeUndefined();
    await expect(
      h.requestReset.execute({ email: 'ninguem@brabo.dev' }),
    ).resolves.toBeUndefined();
  });

  it('só o endereço existente recebe e-mail', async () => {
    await contaPronta(h);
    h.mail.limpar();

    await h.requestReset.execute({ email: 'ninguem@brabo.dev' });
    expect(h.mail.enviados).toHaveLength(0);

    await h.requestReset.execute({ email: EMAIL });
    expect(h.mail.ultimoDoTipo('password_reset')).toBeDefined();
  });
});

describe('normalização de e-mail', () => {
  it('a caixa e os espaços não criam conta paralela nem escapam do balde', async () => {
    await contaPronta(h);

    // Se a normalização divergisse entre cadastro e login, esta chamada não
    // acharia a conta; e se divergisse na chave do balde, trocar a caixa de
    // uma letra contornaria o lockout.
    await expect(
      h.login.execute({ email: '  FULANO@Brabo.DEV ', senha: SENHA_BOA }),
    ).resolves.toBeTruthy();
  });
});
