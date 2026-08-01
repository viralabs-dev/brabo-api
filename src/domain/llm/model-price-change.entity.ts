export const PRICE_CHANGE_SOURCES = ['manual', 'sync'] as const;
export type PriceChangeSource = (typeof PRICE_CHANGE_SOURCES)[number];

/**
 * Uma mudança de preço de modelo (Fase 9c, RN-044).
 *
 * Log de domínio IMUTÁVEL, como `session_events`: nunca se faz UPDATE aqui.
 * Fica em tabela própria e não no outbox porque `Engine.Outbox.Drain.run_once/0`
 * filtra `aggregate_type == "session"` — uma linha de preço lá ficaria com
 * `processed_at` nulo para sempre e sujaria a métrica de lag da outbox.
 *
 * O par antes/depois é gravado junto de propósito: reconstruir o "antes" a
 * partir da linha anterior dependeria de nenhuma escrita ter escapado do
 * caminho auditado, e é justamente isso que a auditoria existe para provar.
 */
export interface ModelPriceChange {
  id: string;
  modelId: string;
  inputBeforeMicros: number;
  inputAfterMicros: number;
  outputBeforeMicros: number;
  outputAfterMicros: number;
  source: PriceChangeSource;
  /** `null` quando veio do sync — não há pessoa por trás. */
  changedBy: string | null;
  createdAt: Date;
}
