import { describe, it, expect, beforeEach } from 'vitest';
import { AceitarHandoffAutomaticamenteUseCase } from '../../../../src/application/use-cases/agents/aceitar-handoff-automaticamente.use-case';

/**
 * RN-660 (ADR 0186, AT-314): o caso de uso LÊ o que a decisão pede e, com
 * "sim", delega o aceite a `AcceptHandoffUseCase` com o ator de sistema — o
 * provisionamento continua lá (RN-582). Com "não", nada é gravado; com falha
 * depois do "sim", o desfecho vira evento nomeado e nunca sobe ao engine.
 */
const PROJECT = 'p1';
const SESSION = 's1';
const AUTOR = 'u-autor';

let regras: { id: string }[];
let historias: { id: string; title: string; businessRuleIds: string[] }[];
let repositorio: { provider: string } | null;
let conexoes: Record<string, unknown>;
let papel: string | null;
let aceites: unknown[][];
let erroNoAceite: Error | null;
let ligada: boolean;
let mapa: unknown;
let adrs: unknown[];
let perguntas: { payload: Record<string, unknown> }[];
let respostas: { payload: Record<string, unknown> }[];
let artefatosDeInfra: unknown[];
let emRevisao: unknown[];
let ciclo: { status: string } | null;
let eventos: {
  type: string;
  actor: unknown;
  payload: Record<string, unknown>;
}[];
let uc: AceitarHandoffAutomaticamenteUseCase;

const OFERTA = {
  id: 'h1',
  fromAgent: 'po',
  toAgent: 'arquiteto',
  status: 'offered' as const,
};

beforeEach(() => {
  regras = [{ id: 'r1' }, { id: 'r2' }];
  historias = [
    { id: 's1', title: 'A', businessRuleIds: ['r1'] },
    { id: 's2', title: 'B', businessRuleIds: ['r2', 'r1'] },
  ];
  repositorio = null;
  conexoes = {};
  papel = 'developer';
  aceites = [];
  erroNoAceite = null;
  eventos = [];
  ligada = true;
  mapa = { id: 'm1' };
  adrs = [{ id: 'a1' }];
  perguntas = [];
  respostas = [];
  artefatosDeInfra = [{ id: 'i1' }];
  emRevisao = [];
  ciclo = { status: 'running' };
  uc = new AceitarHandoffAutomaticamenteUseCase(
    {
      findInProject: () => Promise.resolve({ id: SESSION, createdBy: AUTOR }),
    } as never,
    {
      listByTypeForProject: (_p: string, tipo: string) =>
        Promise.resolve(
          tipo === 'adr.pr_opened'
            ? adrs
            : tipo === 'artifact.open_question'
              ? perguntas
              : tipo === 'open_question.answered'
                ? respostas
                : regras,
        ),
    } as never,
    { findByProject: () => Promise.resolve(historias) } as never,
    { findByProjectId: () => Promise.resolve(repositorio) } as never,
    {
      findMetadataByProjectAndProvider: (_p: string, provider: string) =>
        Promise.resolve(conexoes[provider] ?? null),
    } as never,
    { forProject: () => Promise.resolve(papel) } as never,
    {
      execute: (_p: string, _s: string, e: (typeof eventos)[number]) => {
        eventos.push(e);
        return Promise.resolve();
      },
    } as never,
    {
      execute: (...args: unknown[]) => {
        if (erroNoAceite) return Promise.reject(erroNoAceite);
        aceites.push(args);
        return Promise.resolve({});
      },
    } as never,
    {
      passagemLigada: () => Promise.resolve(ligada),
      regraDaOfertaLigada: () => Promise.resolve(null),
    } as never,
    { findCurrent: () => Promise.resolve(mapa) } as never,
    { listByProject: () => Promise.resolve(artefatosDeInfra) } as never,
    { execute: () => Promise.resolve(emRevisao) } as never,
    { findByProject: () => Promise.resolve(ciclo) } as never,
  );
});

describe('AceitarHandoffAutomaticamenteUseCase (RN-660)', () => {
  it('backlog coberto e sem repositório: aceita pelo sistema, em nome de quem abriu a sessão', async () => {
    const desfecho = await uc.execute(PROJECT, SESSION, OFERTA);

    expect(desfecho).toEqual({
      aceito: true,
      criterio: { regras: 2, cobertas: 2, repositorio: 'a_provisionar_local' },
    });
    expect(aceites).toHaveLength(1);
    const [p, s, h, u, peloSistema] = aceites[0];
    expect([p, s, h, u]).toEqual([PROJECT, SESSION, 'h1', AUTOR]);
    expect(peloSistema).toMatchObject({
      ator: { kind: 'system', id: 'handoff-auto-accept' },
      criterio: { regras: 2, cobertas: 2 },
    });
  });

  it('uma regra sem história: NÃO aceita e não grava nada — o clique segue pedido', async () => {
    regras.push({ id: 'r3' });

    const desfecho = await uc.execute(PROJECT, SESSION, OFERTA);

    expect(desfecho).toEqual({ aceito: false, motivo: 'regras_sem_historia' });
    expect(aceites).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('repositório remoto continua pedindo o clique', async () => {
    repositorio = { provider: 'github' };

    expect(await uc.execute(PROJECT, SESSION, OFERTA)).toEqual({
      aceito: false,
      motivo: 'repositorio_nao_local',
    });
    expect(aceites).toEqual([]);
  });

  it('conexão de git no projeto continua pedindo o clique', async () => {
    conexoes.gitlab = { provider: 'gitlab' };

    expect(await uc.execute(PROJECT, SESSION, OFERTA)).toEqual({
      aceito: false,
      motivo: 'credencial_de_git_no_projeto',
    });
  });

  it('outra passagem (Criativo → PO) nem consulta o backlog', async () => {
    const desfecho = await uc.execute(PROJECT, SESSION, {
      ...OFERTA,
      fromAgent: 'criativo',
      toAgent: 'po',
    });
    expect(desfecho).toEqual({
      aceito: false,
      motivo: 'passagem_sem_aceite_automatico',
    });
    expect(aceites).toEqual([]);
  });

  it('falha no aceite vira `handoff.auto_accept_failed` com origem, e não sobe', async () => {
    erroNoAceite = new Error('engine fora');

    const desfecho = await uc.execute(PROJECT, SESSION, OFERTA);

    expect(desfecho).toEqual({ aceito: false, motivo: 'falhou' });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      type: 'handoff.auto_accept_failed',
      actor: { kind: 'system', id: 'handoff-auto-accept' },
      payload: { handoffId: 'h1', origem: 'infra', error: 'engine fora' },
    });
  });

  describe('AT-994: Arquiteto → Infra e Infra → Dev Lead sem clique', () => {
    const ARQ = {
      ...OFERTA,
      id: 'h2',
      fromAgent: 'arquiteto',
      toAgent: 'infra',
    };
    const INF = {
      ...OFERTA,
      id: 'h3',
      fromAgent: 'infra',
      toAgent: 'dev-lead',
    };

    it('Arquiteto → Infra com o critério fechado aceita pelo sistema (e2e do caso de uso)', async () => {
      const d = await uc.execute(PROJECT, SESSION, ARQ);
      expect(d).toEqual({
        aceito: true,
        criterio: {
          passagem: 'arquiteto->infra',
          repositorio: 'a_provisionar_local',
        },
      });
      expect(aceites).toHaveLength(1);
    });

    it('pergunta do Arquiteto sem resposta pede o clique; respondida, não', async () => {
      perguntas = [{ payload: { autor: 'arquiteto', questionId: 'q1' } }];
      expect(await uc.execute(PROJECT, SESSION, ARQ)).toEqual({
        aceito: false,
        motivo: 'pergunta_em_aberto',
      });
      respostas = [{ payload: { questionId: 'q1' } }];
      expect((await uc.execute(PROJECT, SESSION, ARQ)).aceito).toBe(true);
    });

    it('pergunta de OUTRO agente não segura a passagem', async () => {
      perguntas = [{ payload: { autor: 'po', questionId: 'q9' } }];
      expect((await uc.execute(PROJECT, SESSION, ARQ)).aceito).toBe(true);
    });

    it('chave desligada volta a pedir o clique', async () => {
      ligada = false;
      expect(await uc.execute(PROJECT, SESSION, ARQ)).toEqual({
        aceito: false,
        motivo: 'passagem_desligada',
      });
      expect(aceites).toEqual([]);
    });

    it('sem module_map ou sem ADR pede o clique', async () => {
      mapa = null;
      expect((await uc.execute(PROJECT, SESSION, ARQ)).aceito).toBe(false);
      mapa = { id: 'm1' };
      adrs = [];
      expect(await uc.execute(PROJECT, SESSION, ARQ)).toEqual({
        aceito: false,
        motivo: 'sem_adr_proposta',
      });
    });

    it('Infra → Dev Lead: PR mergeada e container rodando aceita', async () => {
      expect((await uc.execute(PROJECT, SESSION, INF)).aceito).toBe(true);
    });

    it('Infra → Dev Lead: PR ainda em revisão, sem artefato ou container não rodando recusa', async () => {
      emRevisao = [{ id: 'i1' }];
      expect(await uc.execute(PROJECT, SESSION, INF)).toEqual({
        aceito: false,
        motivo: 'pr_de_infra_nao_mergeada',
      });
      emRevisao = [];
      artefatosDeInfra = [];
      expect((await uc.execute(PROJECT, SESSION, INF)).aceito).toBe(false);
      artefatosDeInfra = [{ id: 'i1' }];
      ciclo = { status: 'provisioning' };
      expect(await uc.execute(PROJECT, SESSION, INF)).toEqual({
        aceito: false,
        motivo: 'container_nao_rodando',
      });
    });
  });
});
