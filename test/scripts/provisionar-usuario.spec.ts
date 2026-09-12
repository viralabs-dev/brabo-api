import { describe, expect, it, vi, afterEach } from 'vitest';
import type { INestApplicationContext } from '@nestjs/common';
import { provisionarUsuario } from '../../src/scripts/provisionar-usuario';
import { ProvisionarUsuarioUseCase } from '../../src/application/use-cases/auth/provisionar-usuario.use-case';

/**
 * O que a extração do ADR 0155 precisa preservar.
 *
 * O núcleo saiu daqui para `ProvisionarUsuarioUseCase`, para que a rota
 * interna de primeira conta (RN-546) pudesse usá-lo em PRODUÇÃO sem
 * `BRABO_FORCE_SEED`. A recusa FICOU, porque ela protege este chamador — um
 * script que escolhe a senha sozinho —, e não o trio de escritas. Se alguém
 * um dia mover a recusa junto com o núcleo, é este teste que reprova.
 */
describe('provisionarUsuario (script de automação, ADR 0155)', () => {
  const antesNodeEnv = process.env.NODE_ENV;
  const antesForceSeed = process.env.BRABO_FORCE_SEED;

  afterEach(() => {
    if (antesNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = antesNodeEnv;
    if (antesForceSeed === undefined) delete process.env.BRABO_FORCE_SEED;
    else process.env.BRABO_FORCE_SEED = antesForceSeed;
  });

  function appCom(execute: ReturnType<typeof vi.fn>): INestApplicationContext {
    return {
      get: (token: unknown) =>
        token === ProvisionarUsuarioUseCase ? { execute } : undefined,
    } as unknown as INestApplicationContext;
  }

  it('caminho feliz: fora de produção, DELEGA ao caso de uso sem reescrever nada', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.BRABO_FORCE_SEED;
    const execute = vi.fn(() =>
      Promise.resolve({ user: { id: 'u1' }, criado: true }),
    );

    const resultado = await provisionarUsuario(appCom(execute), {
      email: 'owner@brabo.dev',
      nome: 'Dona da Casa',
      senha: 'brabo12345678',
    });

    expect(execute).toHaveBeenCalledWith({
      email: 'owner@brabo.dev',
      nome: 'Dona da Casa',
      senha: 'brabo12345678',
    });
    expect(resultado).toEqual({ user: { id: 'u1' }, criado: true });
  });

  it('FALHA: em produção sem `BRABO_FORCE_SEED`, RECUSA — e nem chega ao caso de uso', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BRABO_FORCE_SEED;
    const execute = vi.fn();

    await expect(
      provisionarUsuario(appCom(execute), {
        email: 'owner@brabo.dev',
        nome: null,
        senha: 'brabo12345678',
      }),
    ).rejects.toThrow(/recusa rodar com NODE_ENV=production/);

    expect(execute).not.toHaveBeenCalled();
  });

  it('em produção COM `BRABO_FORCE_SEED`, passa — o escape do bootstrap do k8s continua existindo', async () => {
    process.env.NODE_ENV = 'production';
    process.env.BRABO_FORCE_SEED = '1';
    const execute = vi.fn(() =>
      Promise.resolve({ user: { id: 'u1' }, criado: false }),
    );

    await provisionarUsuario(appCom(execute), {
      email: 'owner@brabo.dev',
      nome: null,
      senha: 'brabo12345678',
    });

    expect(execute).toHaveBeenCalled();
  });
});
