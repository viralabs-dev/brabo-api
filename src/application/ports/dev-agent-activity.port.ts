/**
 * Existe dev agent NÃO-ocioso para um projeto — em QUALQUER sessão dele, não
 * uma só (RN-447, ADR 0111)?
 *
 * A leitura é direta de `engine.dev_agent_states` (schema Postgres do
 * engine, mesmo banco físico), o mesmo caminho já provado pela RN-409
 * (`ProjectCardSummary.onlineAgentCount`, `projects-summary.repository.ts`)
 * — em vez de reconstruir "trabalhando ou travado" a partir do event log
 * (`GetSessionPendingWorkUseCase`, RN-411/412), que é por SESSÃO. Um dev
 * agent não migra de raiz de escopo sozinho quando a sessão muda de baixo
 * dele, e `ConvertProjectExecutionModeUseCase` precisa da resposta pro
 * PROJETO inteiro, através de todas as sessões que já ativaram execução —
 * reconstruir isso via event log exigiria varrer sessão por sessão.
 *
 * `idle` é o ÚNICO status que não conta como ativo: qualquer outro
 * (`working`/`blocked`/`idle_tripped`/`awaiting_gate`/`awaiting_approval`)
 * significa que o `DevAgentServer` (Elixir) tem `workspace_root` capturado
 * em memória desde a criação do worktree — mudar a raiz de escopo por baixo
 * de um processo vivo moveria o chão debaixo dele.
 */
export abstract class DevAgentActivityPort {
  abstract hasActiveAgents(projectId: string): Promise<boolean>;
}
