import type { SpendBucket } from '../../ports/token-usage-repository.port';

/** Uma linha de ranking do relatório de gasto. */
export interface SpendLinha {
  chave: string;
  rotulo: string | null;
  actorKind: string | null;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
}

/** Um ponto da série diária — o que a sparkline desenha. */
export interface SpendPorDia {
  /** `YYYY-MM-DD`, em UTC, como o banco devolve. */
  dia: string;
  costMicros: number;
  chamadas: number;
}

export interface SpendTotais {
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  chamadas: number;
}

export function somarTotais(linhas: SpendBucket[]): SpendTotais {
  return linhas.reduce<SpendTotais>(
    (total, linha) => ({
      costMicros: total.costMicros + linha.costMicros,
      inputTokens: total.inputTokens + linha.inputTokens,
      outputTokens: total.outputTokens + linha.outputTokens,
      chamadas: total.chamadas + linha.chamadas,
    }),
    { costMicros: 0, inputTokens: 0, outputTokens: 0, chamadas: 0 },
  );
}

/**
 * A série diária DENSA: todo dia da janela aparece, inclusive os de zero.
 *
 * O `GROUP BY` só devolve dia que teve chamada, e uma sparkline montada sobre
 * buracos mente sobre o ritmo — três chamadas em três semanas viram três
 * barras coladas, indistinguíveis de três dias seguidos de uso. Densificar aqui
 * (e não no SQL, com `generate_series`) mantém a consulta igual para as cinco
 * dimensões.
 *
 * `hoje` entra como parâmetro para o teste não depender do relógio.
 */
export function densificarPorDia(
  buckets: SpendBucket[],
  dias: number,
  hoje: Date,
): SpendPorDia[] {
  const porChave = new Map(buckets.map((b) => [b.chave, b]));
  const serie: SpendPorDia[] = [];
  const fim = Date.UTC(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth(),
    hoje.getUTCDate(),
  );

  for (let i = dias - 1; i >= 0; i -= 1) {
    const dia = new Date(fim - i * 86_400_000).toISOString().slice(0, 10);
    const bucket = porChave.get(dia);
    serie.push({
      dia,
      costMicros: bucket?.costMicros ?? 0,
      chamadas: bucket?.chamadas ?? 0,
    });
  }

  return serie;
}

export function comoLinhas(buckets: SpendBucket[]): SpendLinha[] {
  return buckets.map((b) => ({
    chave: b.chave,
    rotulo: b.rotulo,
    actorKind: b.actorKind,
    costMicros: b.costMicros,
    inputTokens: b.inputTokens,
    outputTokens: b.outputTokens,
    chamadas: b.chamadas,
  }));
}

/** Janela aceita pelas duas rotas de gasto. */
export const DIAS_PADRAO = 30;
export const DIAS_MAXIMO = 180;

export function janelaValida(dias: unknown): number {
  const n = Number(dias);
  if (!Number.isFinite(n) || n < 1) return DIAS_PADRAO;
  return Math.min(Math.floor(n), DIAS_MAXIMO);
}
