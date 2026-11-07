import { describe, expect, it } from 'vitest';
import { refusalReason } from './test-db-name';

const ok = {
  DATABASE_URL: 'postgres://u:p@172.17.0.2:5432/postgres',
  TEST_DATABASE_URL: 'postgres://u:p@172.17.0.2:5432/brabo_test',
};

describe('refusalReason (AT-775)', () => {
  it('aceita um Postgres descartável pelo IP do container', () => {
    expect(refusalReason(ok)).toBeNull();
  });
  it('recusa sem DATABASE_URL ou sem TEST_DATABASE_URL', () => {
    expect(refusalReason({ TEST_DATABASE_URL: ok.TEST_DATABASE_URL })).toMatch(
      /obrigatórias/,
    );
    expect(refusalReason({ DATABASE_URL: ok.DATABASE_URL })).toMatch(
      /obrigatórias/,
    );
  });
  it('recusa localhost:5432 (porta explícita ou implícita) sem a opção', () => {
    const a = { ...ok, DATABASE_URL: 'postgres://u:p@localhost:5432/postgres' };
    const b = {
      ...ok,
      TEST_DATABASE_URL: 'postgres://u:p@127.0.0.1/brabo_test',
    };
    expect(refusalReason(a)).toMatch(/5432/);
    expect(refusalReason(b)).toMatch(/5432/);
  });
  it('aceita localhost:5432 com BRABO_TESTE_PERMITE_5432', () => {
    const env = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/brabo',
      TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/brabo_test',
      BRABO_TESTE_PERMITE_5432: '1',
    };
    expect(refusalReason(env)).toBeNull();
  });
  it('aceita localhost em outra porta', () => {
    expect(
      refusalReason({
        DATABASE_URL: 'postgres://u:p@localhost:55432/postgres',
        TEST_DATABASE_URL: 'postgres://u:p@localhost:55432/brabo_test',
      }),
    ).toBeNull();
  });
  it('recusa quando o banco alvo é brabo, mesmo com a opção', () => {
    expect(
      refusalReason({
        ...ok,
        TEST_DATABASE_URL: 'postgres://u:p@172.17.0.2:5432/brabo',
        BRABO_TESTE_PERMITE_5432: '1',
      }),
    ).toMatch(/"brabo"/);
  });
});
