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
  uc = new AceitarHandoffAutomaticamenteUseCase(
    {
      findInProject: () => Promise.resolve({ id: SESSION, createdBy: AUTOR }),
    } as never,
    { listByTypeForProject: () => Promise.resolve(regras) } as never,
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
      motivo: 'nao_e_po_para_arquiteto',
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
});
