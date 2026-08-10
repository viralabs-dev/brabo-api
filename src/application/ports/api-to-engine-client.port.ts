import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { DevAgentImpl } from '../../domain/execution/dev-agent-impl';

export abstract class ApiToEngineClient {
  abstract startSession(
    sessionId: string,
    projectId: string,
    /**
     * `traceparent` da span raiz da sessão. O engine o guarda no próprio estado
     * e pendura nele toda span de trabalho da sessão — é o que faz "uma sessão
     * = uma trace" atravessar api e engine (Fase 5, item 3).
     */
    traceParent?: string | null,
  ): Promise<void>;

  /**
   * Síncrono — espera o engine terminar de rodar o comando (ou estourar o
   * timeout dele) antes de retornar. Lança em falha de transporte/HTTP; um
   * exitCode != 0 no resultado retornado NÃO é uma falha de transporte, é
   * o comando tendo falhado de verdade (vira status `failed` na api).
   */
  abstract executeTerminalAction(
    projectId: string,
    sessionId: string,
    actionId: string,
    command: string,
    cwd?: string,
  ): Promise<TerminalExecutionResult>;

  // --- Agentes conversacionais (Fase 3b) ---

  // Sobe o processo do agente (ex. Criativo) no engine, atado à sessão.
  abstract startAgent(
    projectId: string,
    sessionId: string,
    agent: string,
  ): Promise<void>;

  // Roteia uma mensagem do usuário pro agente ativo; o engine roda o turno no
  // harness e narra a resposta via session_events (não retorna o texto aqui —
  // o streaming vai pelo canal Phoenix e a persistência pelo event log).
  abstract sendAgentMessage(
    projectId: string,
    sessionId: string,
    agent: string,
    text: string,
  ): Promise<void>;

  // Sinaliza que o usuário confirmou prontidão; o engine instrui o Criativo a
  // emitir o product_brief e oferecer o handoff ao PO.
  abstract confirmReadiness(
    projectId: string,
    sessionId: string,
  ): Promise<void>;

  // --- Execução (Fase 4a) ---

  // Sobe os DevAgentServers (um por módulo) no engine. `impl` escolhe a
  // implementação: 'real' (ToolLoop + LLM) ou 'noop' (NoopDevAgentServer —
  // smoke test da infraestrutura, sem LLM).
  abstract startExecution(
    projectId: string,
    sessionId: string,
    modules: string[],
    taskBudgetMicros?: number,
    maxGateCorrections?: number,
    impl?: DevAgentImpl,
    maxConsecutiveBlocked?: number,
  ): Promise<void>;

  // Executa uma ação git (git_commit/git_push) no worktree do agente, no
  // engine — síncrono, espelha executeTerminalAction. Retorna o resultado
  // bruto (sha/branch) que o use-case grava em execution_result.
  abstract executeGitAction(
    projectId: string,
    sessionId: string,
    actionId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  // Aceite (um clique) da sugestão de paralelização — sobe um dev extra.
  abstract acceptParallelization(
    projectId: string,
    sessionId: string,
    module: string,
  ): Promise<void>;

  // Rearma um dev agent travado pelo circuit breaker (Fase 12b — RN-047):
  // zera o contador de blocked consecutivas e devolve o agente a tentar
  // reivindicar. Lança (404 do engine) se o agente não existe.
  abstract rearmDevAgent(
    projectId: string,
    sessionId: string,
    agentId: string,
  ): Promise<void>;

  // Devolve ao PO uma história que o usuário RECUSOU promover (Fase 12c —
  // RN-048). Espelha a devolução de gate ao dev: o motivo vira uma mensagem
  // fixada na sessão do PO, que decide o que fazer e registra. Lança (404 do
  // engine) se o PO daquela sessão não está mais de pé — a recusa em si já
  // está gravada, e é o chamador que decide se isso é fatal.
  abstract reviseStory(
    projectId: string,
    sessionId: string,
    storyId: string,
    title: string,
    reason: string,
  ): Promise<void>;

  // Sinaliza que o usuário confirmou que a arquitetura está pronta (Fase 4a
  // — fechamento): o engine instrui o Arquiteto a oferecer o handoff ao
  // InfraAgent (mirror de confirmReadiness, sem reaproveitar o endpoint do
  // Criativo — agentes diferentes, momentos diferentes do fluxo).
  abstract offerInfraHandoff(
    projectId: string,
    sessionId: string,
  ): Promise<void>;

  /** FASE 14d: o Dev Lead recebe da MESMA confirmação de arquitetura pronta. */
  abstract offerDevHandoff(projectId: string, sessionId: string): Promise<void>;

  // Reprocessamento explícito da análise do Psicólogo (Fase 4b) — o
  // engine enfileira o job do PsychologistWorker com triggeredBy:
  // "manual" (sempre roda, mesmo se já houver análise current pra
  // sessão; a análise antiga vira superseded, não é apagada).
  //
  // Lança `PsychologistDisabledError` quando a flag global
  // `PSYCHOLOGIST_ENABLED` do engine está desligada (decisão de produto —
  // ver docs/explanation/backlog.md); o chamador decide o que fazer com
  // isso.
  abstract reanalyzeSession(
    projectId: string,
    sessionId: string,
  ): Promise<void>;

  // Descarta o cache de instruções do agente no engine (Fase 4b) —
  // depois de um instruction_patch aprovado ou de um rollback, senão os
  // agentes seguem servindo o conteúdo antigo em memória. Best-effort:
  // o chamador NUNCA falha o patch por causa disto (o conteúdo já está
  // no banco; sem invalidar, os agentes só pegam ao reiniciar).
  /**
   * Roda a Anamnese do projeto AGORA, sem esperar o tick periódico. O engine
   * escolhe a mesma sessão que o scheduler escolheria; projeto sem sessão não
   * tem log pra analisar.
   *
   * Lança `AnamneseDisabledError` quando a flag global `ANAMNESE_ENABLED` do
   * engine está desligada (decisão de produto — ver
   * docs/explanation/backlog.md); o chamador decide o que fazer com isso.
   */
  abstract runAnamnese(projectId: string): Promise<void>;
  abstract invalidateInstructions(
    projectId: string,
    agent: string,
  ): Promise<void>;
}
