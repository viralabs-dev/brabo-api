/**
 * Vocabulário de eventos que o `GraphProjector`
 * (`application/graph-projection/graph-projector.ts`) consome para
 * alimentar a memória relacional do grafo de conhecimento (Onda 2 da
 * fundação — ver CLAUDE.md, "Neo4j como grafo de conhecimento").
 *
 * ## Por que um `aggregate_type` de outbox NOVO, e não o `'session'` de sempre
 *
 * `Engine.Outbox.Drain.run_once/0` (lado Elixir, `apps/engine`) só drena
 * `aggregate_type IN ('session', 'task')` — TODO evento de sessão (incluindo
 * `handoff.offered`, `psychologist.hypothesis_proposed`,
 * `anamnese.profile_updated`) já nasce com uma linha `aggregate_type:
 * 'session'` gravada por `AppendSessionEventUseCase`, e o dreno do engine
 * marca essa linha `processed_at` a cada ~2s (ciclo de
 * `Engine.Workers.OutboxDrainWorker`). Se o `GraphProjector` tentasse ler o
 * MESMO `aggregate_type`, ele correria contra esse dreno e perderia a
 * corrida quase sempre — a linha já estaria `processed_at IS NOT NULL`
 * antes do próximo ciclo do projetor.
 *
 * A saída, mantendo a MESMA tabela `outbox_events` (nunca uma fila nova):
 * gravar uma SEGUNDA linha, na MESMA transação de domínio, com
 * `aggregate_type: 'graph_projection'` — um valor que a query do drenador do
 * engine nunca vai casar. Mesmo padrão já usado no produto para múltiplos
 * consumidores do mesmo evento de domínio (ex.: `deny-action.use-case.ts`
 * grava `'proposed_action'` E `'task'` na mesma transação).
 */
export const GRAPH_PROJECTION_AGGREGATE_TYPE = 'graph_projection';

/**
 * Tipos de `session_events`/eventos de domínio que têm caso de uso de
 * gravação no grafo (`application/use-cases/graph/record-*.use-case.ts`).
 * Tipo fora deste conjunto nunca ganha linha de projeção — evita que a
 * outbox cresça com sinais que ninguém no grafo vai consumir.
 */
export const GRAPH_PROJECTABLE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'handoff.offered',
  'psychologist.hypothesis_proposed',
  'anamnese.profile_updated',
  'session.closed',
  'session.closed_abnormally',
]);
