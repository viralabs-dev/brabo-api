import { describe, it, expect } from 'vitest';
import { mascararSaida } from '../../../src/domain/actions/mascara-da-saida';

describe('mascararSaida (AT-1038, RN-1549)', () => {
  it('esconde a senha da URL, curta ou longa, mantendo host e banco', () => {
    expect(mascararSaida('postgres://app:abc@db:5432/meu')).toBe(
      'postgres://app:[oculto]@db:5432/meu',
    );
    expect(mascararSaida('postgres://app:senha-fake-comprida-123@db/x')).toBe(
      'postgres://app:[oculto]@db/x',
    );
  });

  it('esconde várias URLs, declaradas ou não', () => {
    expect(mascararSaida('a redis://u:p1@r b mysql://v:p2@m')).toBe(
      'a redis://u:[oculto]@r b mysql://v:[oculto]@m',
    );
  });

  it('esconde o valor de nome de segredo com 8+ caracteres, em todas as ocorrências', () => {
    const env = { SECRET_KEY: 'fake-valor-12345678' };
    expect(
      mascararSaida('x fake-valor-12345678 y fake-valor-12345678', [env]),
    ).toBe('x [oculto] y [oculto]');
  });

  it('troca o maior primeiro e aceita caracteres especiais de regex', () => {
    const envs = [
      { API_TOKEN: 'fake+(1)[a].*$12' },
      { OUTRO_TOKEN: 'fake+(1)[a].*$12-longo' },
    ];
    expect(mascararSaida('v=fake+(1)[a].*$12-longo', envs)).toBe('v=[oculto]');
  });

  it('valor curto e nome comum ficam', () => {
    const envs = [
      {
        DB_PASSWORD: 'abc',
        POSTGRES_USER: 'app',
        NODE_ENV: 'production-fake-longo',
      },
    ];
    const t = 'abc app production-fake-longo';
    expect(mascararSaida(t, envs)).toBe(t);
  });

  it('sem nada a mascarar, a saída é idêntica', () => {
    expect(mascararSaida('ls -la\n')).toBe('ls -la\n');
    expect(mascararSaida('ls', [{}])).toBe('ls');
  });
});
