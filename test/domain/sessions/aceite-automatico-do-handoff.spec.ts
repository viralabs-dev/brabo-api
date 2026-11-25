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
    [
      { fromAgent: 'criativo', toAgent: 'po' },
      'passagem_sem_aceite_automatico',
    ],
    [{ toAgent: 'dev-lead' }, 'passagem_sem_aceite_automatico'],
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

/** AT-994 (RN-1421..1424): as passagens Arquiteto→Infra e Infra→Dev Lead. */
describe('decidirAceiteAutomatico: Arquiteto → Infra (RN-1422)', () => {
  const ARQ: EntradaDoAceiteAutomatico = {
    ...BASE,
    fromAgent: 'arquiteto',
    toAgent: 'infra',
    passagemLigada: true,
    arquitetura: {
      moduleMapVigente: true,
      adrProposta: true,
      perguntasEmAberto: 0,
    },
  };

  it('critério fechado: aceita', () => {
    expect(decidirAceiteAutomatico(ARQ)).toEqual({
      aceita: true,
      criterio: {
        passagem: 'arquiteto->infra',
        repositorio: 'a_provisionar_local',
      },
    });
  });

  it.each([
    [{ passagemLigada: false }, 'passagem_desligada'],
    [{ arquitetura: undefined }, 'sem_module_map'],
    [
      {
        arquitetura: {
          moduleMapVigente: false,
          adrProposta: true,
          perguntasEmAberto: 0,
        },
      },
      'sem_module_map',
    ],
    [
      {
        arquitetura: {
          moduleMapVigente: true,
          adrProposta: false,
          perguntasEmAberto: 0,
        },
      },
      'sem_adr_proposta',
    ],
    [
      {
        arquitetura: {
          moduleMapVigente: true,
          adrProposta: true,
          perguntasEmAberto: 1,
        },
      },
      'pergunta_em_aberto',
    ],
    [{ providerDoRepositorio: 'github' }, 'repositorio_nao_local'],
    [{ credencialDeGitNoProjeto: true }, 'credencial_de_git_no_projeto'],
    [{ papelDoAutor: 'viewer' as const }, 'autor_sem_papel'],
    [{ status: 'accepted' }, 'oferta_nao_pendente'],
  ])('recusa %j com o motivo %s', (mudanca, motivo) => {
    expect(decidirAceiteAutomatico({ ...ARQ, ...mudanca })).toEqual({
      aceita: false,
      motivo,
    });
  });
});

describe('decidirAceiteAutomatico: Infra → Dev Lead (RN-1423)', () => {
  const INF: EntradaDoAceiteAutomatico = {
    ...BASE,
    fromAgent: 'infra',
    toAgent: 'dev-lead',
    passagemLigada: true,
    infra: { prsMergeadas: true, containerRodando: true },
  };

  it('PR mergeada e container rodando: aceita', () => {
    expect(decidirAceiteAutomatico(INF)).toMatchObject({
      aceita: true,
      criterio: { passagem: 'infra->dev-lead' },
    });
  });

  it.each([
    [{ passagemLigada: false }, 'passagem_desligada'],
    [{ infra: undefined }, 'pr_de_infra_nao_mergeada'],
    [
      { infra: { prsMergeadas: false, containerRodando: true } },
      'pr_de_infra_nao_mergeada',
    ],
    [
      { infra: { prsMergeadas: true, containerRodando: false } },
      'container_nao_rodando',
    ],
  ])('recusa %j com o motivo %s', (mudanca, motivo) => {
    expect(decidirAceiteAutomatico({ ...INF, ...mudanca })).toEqual({
      aceita: false,
      motivo,
    });
  });
});

describe('decidirAceiteAutomatico — regra da oferta (RN-1437, AT-998)', () => {
  const OFERTA: EntradaDoAceiteAutomatico = {
    ...BASE,
    fromAgent: 'dev-lead',
    toAgent: 'qa-lead',
    regraDaOferta: true,
  };

  it('passagem fora das três, COM a regra aceita: aceita, dizendo que veio da oferta', () => {
    expect(decidirAceiteAutomatico(OFERTA)).toEqual({
      aceita: true,
      criterio: {
        passagem: 'dev-lead->qa-lead',
        repositorio: 'a_provisionar_local',
        origem: 'oferta',
      },
    });
  });

  it('sem a regra, a passagem continua pedindo o clique', () => {
    expect(
      decidirAceiteAutomatico({ ...OFERTA, regraDaOferta: false }),
    ).toEqual({ aceita: false, motivo: 'passagem_sem_aceite_automatico' });
  });

  it('a regra não afrouxa as travas: repositório de outro provider recusa', () => {
    expect(
      decidirAceiteAutomatico({ ...OFERTA, providerDoRepositorio: 'github' }),
    ).toEqual({ aceita: false, motivo: 'repositorio_nao_local' });
  });
});
