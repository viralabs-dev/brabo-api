import { describe, it, expect } from 'vitest';
import {
  motivoDeRecusaDoSempreAprovar,
  TIPOS_SEM_SEMPRE_PERMITIR,
} from '../../../src/domain/actions/sempre-permitir';
import { ACTION_TYPES } from '../../../src/domain/actions/decide';

// AT-320 (RN-642): a lista ÚNICA dos tipos para os quais "sempre permitir"
// nunca grava padrão. A web esconde o botão por uma cópia conferida contra
// este arquivo (`apps/web/src/lib/sempre-permitir.test.ts`).
describe('motivoDeRecusaDoSempreAprovar (AT-320)', () => {
  it.each([...TIPOS_SEM_SEMPRE_PERMITIR])(
    'recusa o tipo do teto `%s`, nomeando o tipo',
    (tipo) => {
      const motivo = motivoDeRecusaDoSempreAprovar(tipo, {});
      expect(motivo).toContain(`"${tipo}"`);
    },
  );

  it('o git TIPADO está na lista: push, PR e merge (a metade tipada da RN-418)', () => {
    expect(TIPOS_SEM_SEMPRE_PERMITIR).toEqual(
      expect.arrayContaining(['git_push', 'pr_open', 'git_merge']),
    );
  });

  it('terminal é julgado pelo COMANDO: `git push` e `sudo` recusam, `pnpm test` passa', () => {
    expect(
      motivoDeRecusaDoSempreAprovar('terminal', { command: 'git push origin' }),
    ).not.toBeNull();
    expect(
      motivoDeRecusaDoSempreAprovar('terminal', { command: 'sudo ls' }),
    ).not.toBeNull();
    expect(
      motivoDeRecusaDoSempreAprovar('terminal', { command: 'pnpm test' }),
    ).toBeNull();
  });

  it('tipo fora do teto passa (`git_commit`, `container_start`)', () => {
    for (const tipo of ['git_commit', 'container_start']) {
      expect(motivoDeRecusaDoSempreAprovar(tipo, {})).toBeNull();
    }
  });

  // AT-371 (RN-709): abrir PR de ADR/infra publica no provider — a mesma
  // metade tipada do teto da RN-418 que `pr_open`. Antes este teste fixava
  // `open_adr_pr` passando.
  it('PR de ADR e de infra recusam, como `pr_open`', () => {
    for (const tipo of ['open_adr_pr', 'open_infra_pr']) {
      expect(motivoDeRecusaDoSempreAprovar(tipo, {})).toMatch(/RN-418/);
    }
  });

  it('toda entrada da lista é um tipo de ação que existe', () => {
    for (const tipo of TIPOS_SEM_SEMPRE_PERMITIR) {
      expect(ACTION_TYPES).toContain(tipo);
    }
  });
});
