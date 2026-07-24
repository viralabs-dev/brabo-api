import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';

export abstract class ApiToEngineClient {
  abstract startSession(sessionId: string, projectId: string): Promise<void>;

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

  // Sobe os DevAgentServers (um por módulo) no engine.
  abstract startExecution(
    projectId: string,
    sessionId: string,
    modules: string[],
    taskBudgetMicros?: number,
    maxGateCorrections?: number,
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

  // Sinaliza que o usuário confirmou que a arquitetura está pronta (Fase 4a
  // — fechamento): o engine instrui o Arquiteto a oferecer o handoff ao
  // InfraAgent (mirror de confirmReadiness, sem reaproveitar o endpoint do
  // Criativo — agentes diferentes, momentos diferentes do fluxo).
  abstract offerInfraHandoff(
    projectId: string,
    sessionId: string,
  ): Promise<void>;

  // Reprocessamento explícito da análise do Psicólogo (Fase 4b) — o
  // engine enfileira o job do PsychologistWorker com triggeredBy:
  // "manual" (sempre roda, mesmo se já houver análise current pra
  // sessão; a análise antiga vira superseded, não é apagada).
  abstract reanalyzeSession(
    projectId: string,
    sessionId: string,
  ): Promise<void>;
}
