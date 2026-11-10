/**
 * O estado do roteador local (Laya, AT-626, ADR 0290) como a api o enxerga. Os
 * cinco estados são nomeados e NUNCA colapsados: a tela precisa dizer por que a
 * opção Laya está inerte (sem GPU não é o mesmo que serviço fora do ar).
 */
export type EstadoDoLaya =
  'nao_configurado' | 'sem_resposta' | 'sem_gpu' | 'lento' | 'proficiente';

export interface SituacaoDoLaya {
  estado: EstadoDoLaya;
  /** Por que não é `proficiente` (ex.: `vram_insuficiente`); `null` quando é. */
  motivo: string | null;
  /** ISO: desde quando o estado é este (nunca "verde" sem data). */
  desde: string;
  dispositivo: string | null;
  vramLivreMiB: number | null;
  p95Ms: number | null;
}

export abstract class RoteadorLocal {
  /** `fresco` ignora o cache de 30 s (o PUT confirma na hora). Nunca lança. */
  abstract situacao(fresco?: boolean): Promise<SituacaoDoLaya>;
}
