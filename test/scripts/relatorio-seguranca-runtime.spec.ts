import { describe, expect, it } from 'vitest';
import {
  formatarDuracao,
  interpretarBalde,
  montarRelatorio,
  padraoTemporal,
  rankingDeBaldes,
  type HitBruto,
} from '../../scripts/relatorio-seguranca-runtime';

/**
 * O relatório do papel `secops-runtime` (docs/fluxo.yml). Só as funções
 * puras — a leitura de `rate_limit_hits` é exercitada rodando o script de
 * verdade, mesmo padrão de `medir-execucao.spec.ts`.
 */

function hit(bucketKey: string, quandoMs: number): HitBruto {
  return { bucketKey, occurredAt: new Date(quandoMs) };
}

describe('interpretarBalde', () => {
  it('reconhece balde de usuário', () => {
    expect(
      interpretarBalde('user:d623c9c9-1dae-40ed-90f5-4c71ae5b95b6'),
    ).toEqual({
      tipo: 'usuario',
      identificador: 'd623c9c9-1dae-40ed-90f5-4c71ae5b95b6',
    });
  });

  it('reconhece balde de IP', () => {
    expect(interpretarBalde('ip:203.0.113.9')).toEqual({
      tipo: 'ip',
      identificador: '203.0.113.9',
    });
  });

  /**
   * `RateLimitGuard` nunca grava outro formato hoje, mas o relatório não
   * deve estourar se algum dia gravar — degrada para `desconhecido` em vez
   * de quebrar.
   */
  it('prefixo desconhecido não estoura, vira categoria própria', () => {
    expect(interpretarBalde('rota:/api/x')).toEqual({
      tipo: 'desconhecido',
      identificador: 'rota:/api/x',
    });
  });
});

describe('rankingDeBaldes', () => {
  it('ordena por volume de hits, decrescente', () => {
    const hits = [
      hit('ip:1.1.1.1', 1000),
      hit('ip:2.2.2.2', 1000),
      hit('ip:2.2.2.2', 2000),
      hit('ip:2.2.2.2', 3000),
    ];

    const ranking = rankingDeBaldes(hits);
    expect(ranking.map((r) => r.bucketKey)).toEqual([
      'ip:2.2.2.2',
      'ip:1.1.1.1',
    ]);
    expect(ranking[0].hits).toBe(3);
    expect(ranking[1].hits).toBe(1);
  });

  it('empate desempata pelo hit mais recente', () => {
    const hits = [
      hit('ip:1.1.1.1', 1000),
      hit('ip:1.1.1.1', 2000),
      hit('ip:2.2.2.2', 1000),
      hit('ip:2.2.2.2', 5000),
    ];

    const ranking = rankingDeBaldes(hits);
    expect(ranking.map((r) => r.bucketKey)).toEqual([
      'ip:2.2.2.2',
      'ip:1.1.1.1',
    ]);
  });

  it('registra primeiro e último hit do balde', () => {
    const hits = [hit('user:u1', 1000), hit('user:u1', 9000)];
    const [linha] = rankingDeBaldes(hits);
    expect(linha.primeiro).toEqual(new Date(1000));
    expect(linha.ultimo).toEqual(new Date(9000));
  });

  it('lista vazia não estoura', () => {
    expect(rankingDeBaldes([])).toEqual([]);
  });
});

describe('padraoTemporal', () => {
  it('distribui hits em fatias fixas, com fatia vazia entrando com zero', () => {
    const hits = [
      hit('ip:1.1.1.1', 0),
      hit('ip:1.1.1.1', 500),
      // fatia do meio (10s–20s) fica vazia de propósito
      hit('ip:1.1.1.1', 21_000),
    ];

    const fatias = padraoTemporal(hits, 10_000);
    expect(fatias).toHaveLength(3);
    expect(fatias.map((f) => f.hits)).toEqual([2, 0, 1]);
  });

  it('um hit só não tem intervalo a fatiar', () => {
    expect(padraoTemporal([hit('ip:1.1.1.1', 1000)], 10_000)).toEqual([]);
  });

  it('sem hit nenhum, lista vazia', () => {
    expect(padraoTemporal([], 10_000)).toEqual([]);
  });

  /** Todos os hits no MESMO instante: um intervalo de duração zero, uma fatia só. */
  it('hits simultâneos ficam na mesma fatia', () => {
    const hits = [hit('ip:1.1.1.1', 5000), hit('ip:1.1.1.1', 5000)];
    // occurredAt igual em todos → fim === inicio → sem intervalo a fatiar
    expect(padraoTemporal(hits, 10_000)).toEqual([]);
  });
});

describe('formatarDuracao', () => {
  it('segundos e minutos', () => {
    expect(formatarDuracao(45_000)).toBe('45s');
    expect(formatarDuracao(125_000)).toBe('2min05s');
  });
});

describe('montarRelatorio', () => {
  it('declara a janela configurada mesmo sem dado nenhum', () => {
    const r = montarRelatorio([], {
      top: 15,
      rateLimitWindowMs: 60_000,
      tamanhoFatiaMs: 10_000,
    });

    expect(r.janelaConfiguravel.retencaoTeoricaMs).toBe(120_000);
    expect(r.janelaObservada.totalHits).toBe(0);
    expect(r.janelaObservada.primeiro).toBeNull();
    expect(r.ranking).toEqual([]);
    expect(r.padraoTemporal).toEqual([]);
  });

  /** As três lacunas são permanentes até haver tráfego real — nunca somem do relatório. */
  it('a seção "não medido" sempre lista as três lacunas', () => {
    const r = montarRelatorio([hit('ip:1.1.1.1', 1000)], {
      top: 15,
      rateLimitWindowMs: 60_000,
      tamanhoFatiaMs: 10_000,
    });

    expect(r.naoMedido).toHaveLength(3);
    expect(r.naoMedido.join(' ')).toContain('detecção automática');
    expect(r.naoMedido.join(' ')).toContain('resposta a incidente');
    expect(r.naoMedido.join(' ')).toContain('postmortem');
  });

  it('respeita o teto `top` no ranking', () => {
    const hits = Array.from({ length: 5 }, (_, i) =>
      hit(`ip:10.0.0.${i}`, i * 1000),
    );
    const r = montarRelatorio(hits, {
      top: 2,
      rateLimitWindowMs: 60_000,
      tamanhoFatiaMs: 10_000,
    });

    expect(r.ranking).toHaveLength(2);
  });

  it('janela observada nunca excede a janela configurada, e o relatório expõe as duas', () => {
    const hits = [hit('ip:1.1.1.1', 0), hit('ip:1.1.1.1', 120_000)];
    const r = montarRelatorio(hits, {
      top: 15,
      rateLimitWindowMs: 60_000,
      tamanhoFatiaMs: 10_000,
    });

    expect(r.janelaObservada.cobertura).toBe('2min00s');
    expect(r.janelaConfiguravel.retencaoTeorica).toBe('2min00s');
  });
});
