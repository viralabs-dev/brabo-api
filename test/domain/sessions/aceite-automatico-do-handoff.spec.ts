import { describe, it, expect } from 'vitest';
import {
  backlogCoberto,
  decidirAceiteAutomatico,
  type EntradaDoAceiteAutomatico,
} from '../../../src/domain/sessions/aceite-automatico-do-handoff';

/**
 * RN-660 (ADR 0186, AT-314): quando o handoff do PO ao Arquiteto dispensa o
 * clique. Cada "não" tem motivo próprio — é ele que a resposta ao engine diz.
 */
const BASE: EntradaDoAceiteAutomatico = {
  fromAgent: 'po',
  toAgent: 'arquiteto',
  status: 'offered',
  cobertura: { regras: 3, semHistoria: 0 },
  providerDoRepositorio: null,
  credencialDeGitNoProjeto: false,
  papelDoAutor: 'developer',
};

describe('backlogCoberto (RN-660)', () => {
  it('ao menos uma regra e nenhuma sem história', () => {
    expect(backlogCoberto({ regras: 2, semHistoria: 0 })).toBe(true);
  });

  it('zero regras NÃO é coberto — "nada a cobrir" não prova trabalho do PO', () => {
    expect(backlogCoberto({ regras: 0, semHistoria: 0 })).toBe(false);
  });

  it('uma regra sem história basta para não ser coberto', () => {
    expect(backlogCoberto({ regras: 4, semHistoria: 1 })).toBe(false);
  });
});

describe('decidirAceiteAutomatico (RN-660)', () => {
  it('PO → Arquiteto, backlog coberto, sem repositório: aceita provisionando local', () => {
    expect(decidirAceiteAutomatico(BASE)).toEqual({
      aceita: true,
      criterio: { regras: 3, cobertas: 3, repositorio: 'a_provisionar_local' },
    });
  });

  it('repositório `local` já existente também aceita', () => {
    const d = decidirAceiteAutomatico({
      ...BASE,
      providerDoRepositorio: 'local',
    });
    expect(d).toMatchObject({
      aceita: true,
      criterio: { repositorio: 'local' },
    });
  });

  it.each([
    [{ fromAgent: 'criativo', toAgent: 'po' }, 'nao_e_po_para_arquiteto'],
    [{ toAgent: 'dev-lead' }, 'nao_e_po_para_arquiteto'],
    [{ status: 'superseded' }, 'oferta_nao_pendente'],
    [{ cobertura: { regras: 0, semHistoria: 0 } }, 'sem_regras_de_negocio'],
    [{ cobertura: { regras: 3, semHistoria: 1 } }, 'regras_sem_historia'],
    [{ providerDoRepositorio: 'github' }, 'repositorio_nao_local'],
    [{ credencialDeGitNoProjeto: true }, 'credencial_de_git_no_projeto'],
    [{ papelDoAutor: 'viewer' }, 'autor_sem_papel'],
    [{ papelDoAutor: null }, 'autor_sem_papel'],
  ] as const)('recusa %o com motivo %s', (mudanca, motivo) => {
    expect(
      decidirAceiteAutomatico({ ...BASE, ...(mudanca as object) }),
    ).toEqual({ aceita: false, motivo });
  });
});
