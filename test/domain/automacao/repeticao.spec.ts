import { describe, it, expect } from 'vitest';
import {
  avaliarRepeticao,
  decisoesDosEventos,
  normalizarMotivo,
  type Decisao,
  type EventoDeDecisao,
} from '../../../src/domain/automacao/repeticao';

const agora = new Date('2026-11-19T12:00:00Z');
const minAtras = (m: number) => new Date(agora.getTime() - m * 60_000);
const ctx = (extra: object = {}) => ({
  agora,
  repositorioLocalSemCredencial: false,
  jaTratadas: new Set<string>(),
  ...extra,
});
const ap = (
  chave: string,
  resultado: Decisao['resultado'],
  m: number,
  escopo = 'infra',
): Decisao => ({
  categoria: 'aprovacao',
  chave,
  escopo,
  resultado,
  em: minAtras(m),
});
const serie = (chave: string, ...r: Decisao['resultado'][]) =>
  r.map((x, i) => ap(chave, x, 60 - i));

describe('avaliarRepeticao (RN-1435)', () => {
  it('3 aprovações iguais seguidas oferecem', () => {
    const h = serie('container_start', 'ok', 'ok', 'ok');
    expect(avaliarRepeticao(h[2], h, ctx())).toMatchObject({
      oferecer: true,
      n: 3,
      assinatura: 'aprovacao|container_start|infra',
    });
  });

  it('2 + 1 recusa + 1 não oferece (a recusa zera)', () => {
    const h = serie('container_start', 'ok', 'ok', 'recusa', 'ok');
    expect(avaliarRepeticao(h[3], h, ctx())).toEqual({
      oferecer: false,
      motivo: 'sem_repeticao',
    });
  });

  it('só 2 seguidas não oferece; fora das 24 h não conta', () => {
    const h2 = serie('container_start', 'ok', 'ok');
    expect(avaliarRepeticao(h2[1], h2, ctx()).oferecer).toBe(false);
    const velhas = [
      ap('container_start', 'ok', 24 * 60 + 5),
      ap('container_start', 'ok', 60),
      ap('container_start', 'ok', 59),
    ];
    expect(avaliarRepeticao(velhas[2], velhas, ctx()).oferecer).toBe(false);
  });

  it('agentes diferentes são assinaturas diferentes', () => {
    const h = [
      ap('container_start', 'ok', 30, 'infra'),
      ap('container_start', 'ok', 20, 'dev-lead'),
      ap('container_start', 'ok', 10, 'infra'),
    ];
    expect(avaliarRepeticao(h[2], h, ctx()).oferecer).toBe(false);
  });

  it.each([
    'git_merge',
    'container_remove',
    'parallelize',
    'git_push',
    'terminal',
  ])('%s nunca é oferecido', (tipo) => {
    const h = serie(tipo, 'ok', 'ok', 'ok');
    expect(avaliarRepeticao(h[2], h, ctx())).toEqual({
      oferecer: false,
      motivo: 'tipo_nunca_automatizavel',
    });
  });

  it('open_infra_pr: oferece em repositório local sem credencial, nunca em GitHub', () => {
    const h = serie('open_infra_pr', 'ok', 'ok', 'ok');
    expect(
      avaliarRepeticao(h[2], h, ctx({ repositorioLocalSemCredencial: true }))
        .oferecer,
    ).toBe(true);
    expect(avaliarRepeticao(h[2], h, ctx())).toEqual({
      oferecer: false,
      motivo: 'repositorio_nao_local',
    });
  });

  it('a oferta já feita, recusada ou virada regra não volta', () => {
    const h = serie('container_start', 'ok', 'ok', 'ok');
    const c = ctx({ jaTratadas: new Set(['aprovacao|container_start|infra']) });
    expect(avaliarRepeticao(h[2], h, c)).toEqual({
      oferecer: false,
      motivo: 'ja_tratada',
    });
  });

  it('anti-laço: 3 desbloqueios que voltam a bloquear viram outro caminho', () => {
    const d = (m: number): Decisao => ({
      categoria: 'desbloqueio',
      chave: 'limite de iteracoes',
      escopo: '',
      resultado: 'ruim',
      em: minAtras(m),
    });
    const h = [d(50), d(40), d(30)];
    expect(avaliarRepeticao(h[2], h, ctx())).toEqual({
      oferecer: 'outro_caminho',
      assinatura: 'desbloqueio|limite de iteracoes|',
      opcoes: ['trocar_modelo', 'pedir_ao_dev_lead', 'arquivar'],
    });
    // 2 ruins ainda não é laço, e 'ruim' no fim também nunca oferece automatizar.
    expect(avaliarRepeticao(h[1], h.slice(0, 2), ctx()).oferecer).toBe(false);
  });
});

describe('decisoesDosEventos', () => {
  const ev = (type: string, payload: object, m: number): EventoDeDecisao => ({
    type,
    payload,
    createdAt: minAtras(m),
  });

  it('aprovação e recusa carregam o agente; o aceite do sistema não conta', () => {
    const d = decisoesDosEventos([
      ev('proposed_action.approved', { actionType: 'x', agente: 'infra' }, 3),
      ev('proposed_action.denied', { actionType: 'x', agente: 'infra' }, 2),
      ev(
        'handoff.accepted',
        { fromAgent: 'a', toAgent: 'b', automatico: true },
        1,
      ),
      ev('handoff.accepted', { fromAgent: 'a', toAgent: 'b' }, 0),
    ]);
    expect(d.map((x) => [x.categoria, x.chave, x.escopo, x.resultado])).toEqual(
      [
        ['aprovacao', 'x', 'infra', 'ok'],
        ['aprovacao', 'x', 'infra', 'recusa'],
        ['handoff', 'a->b', '', 'ok'],
      ],
    );
  });

  it('desbloqueio que volta a bloquear vira ruim; o automático não conta', () => {
    const d = decisoesDosEventos([
      ev(
        'backlog.task_unblocked',
        { taskId: 't1', motivo: 'Falhou 12 vezes' },
        5,
      ),
      ev('backlog.task_blocked', { taskId: 't1' }, 4),
      ev(
        'backlog.task_unblocked',
        { taskId: 't2', motivo: 'Falhou 3 vezes' },
        3,
      ),
      ev(
        'backlog.task_unblocked',
        { taskId: 't3', motivo: 'x', automacao: true },
        2,
      ),
    ]);
    expect(d.map((x) => [x.chave, x.resultado])).toEqual([
      ['falhou # vezes', 'ruim'],
      ['falhou # vezes', 'ok'],
    ]);
  });

  it('normalizarMotivo tira números e pontuação de rota', () => {
    expect(
      normalizarMotivo('Erro /a/b 42 em 0f0f0f0f-1111-2222-3333-444444444444'),
    ).toBe('erro a b # em #');
  });
});
