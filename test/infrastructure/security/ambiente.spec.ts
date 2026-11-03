import { describe, expect, it } from 'vitest';
import { acessoRapidoLigado } from '../../../src/infrastructure/security/ambiente';

const sem = () => {
  throw new Error('ENOENT');
};
const arquivo = (conteudo: string) => () => conteudo;

describe('acessoRapidoLigado (AT-722, L2)', () => {
  it.each([undefined, '', 'dev', 'prd', 'LOCAL', 'local ', 'true'])(
    'variável %j: desligado, com ou sem arquivo',
    (valor) => {
      const env = { BRABO_AMBIENTE: valor } as NodeJS.ProcessEnv;
      expect(acessoRapidoLigado(env, sem)).toBe(false);
      expect(acessoRapidoLigado(env, arquivo('local'))).toBe(false);
    },
  );

  it('NODE_ENV não entra: production + local liga', () => {
    const env = { BRABO_AMBIENTE: 'local', NODE_ENV: 'production' };
    expect(acessoRapidoLigado(env, sem)).toBe(true);
  });

  it('local sem arquivo (pnpm dev) e com arquivo local: liga', () => {
    const env = { BRABO_AMBIENTE: 'local' } as NodeJS.ProcessEnv;
    expect(acessoRapidoLigado(env, sem)).toBe(true);
    expect(acessoRapidoLigado(env, arquivo('local\n'))).toBe(true);
  });

  it.each(['dev', 'prd', '', 'qualquer'])(
    'local com a imagem marcada %j: desligado (a imagem das Actions vence o .env)',
    (marca) => {
      const env = { BRABO_AMBIENTE: 'local' } as NodeJS.ProcessEnv;
      expect(acessoRapidoLigado(env, arquivo(marca))).toBe(false);
    },
  );
});
