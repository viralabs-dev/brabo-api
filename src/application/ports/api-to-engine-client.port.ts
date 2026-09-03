import type { TerminalExecutionResult } from '../../domain/actions/terminal-execution-result';
import type { DevAgentImpl } from '../../domain/execution/dev-agent-impl';
import type { PosturaDeRede } from '../../domain/containers/project-container';

/**
 * O que o RUNNER precisa para compor a `EspecificacaoDeContainer` dele mesmo
 * (`packages/docker-port`, `especificacaoValidada`) — os MESMOS campos de
 * `EntradaDeEspecificacao` menos `raizDoProjeto` (o runner enche esse campo
 * sozinho, com `estado.dir` — a raiz já confirmada e validada no startup da
 * CLI, RN-434/435; ninguém do lado servidor manda caminho de host nenhum
 * para o runner, pelo mesmo motivo que o broker nunca manda pro daemon: quem
 * sabe o caminho de VERDADE é quem está na máquina). Nomes de campo em
 * pt-BR de propósito — é o vocabulário que atravessa engine/runner desde o
 * ADR 0128/0130, e esta é só mais uma parada da mesma composição, não um
 * contrato novo.
 */
export interface EspecificacaoDeContainerParaRunner {
  workspaceDirName: string;
  projectSlug: string;
  workspaceId: string;
  imagem: string;
  imagemVersao: number;
  rede: PosturaDeRede;
  cpus: number;
  memoriaMb: number;
  pidsLimit: number;
}

export interface ContainerIniciadoViaRunner {
  containerId: string;
  nome: string;
  /** `true` quando o container já estava de pé — `start` é idempotente do lado do runner também. */
  jaEstavaDePe: boolean;
}

/**
 * O runner não respondeu — nunca conectado, ou caiu no meio da espera
 * (`RunnerRouter.exec/4` já devolve o mesmo par `{:error, :not_connected}` |
 * `{:error, :timeout}` para o caminho de terminal; esta classe é o espelho
 * do lado api para o caminho de container). Origem `infra`: falta uma peça
 * de AMBIENTE (o CLI rodando na máquina do usuário), nunca defeito de quem
 * chamou.
 */
export class RunnerNaoConectadoError extends Error {
  readonly origem = 'infra';
  readonly motivo: 'not_connected' | 'timeout';

  constructor(motivo: 'not_connected' | 'timeout', detalhe: string) {
    super(detalhe);
    this.name = 'RunnerNaoConectadoError';
    this.motivo = motivo;
  }
}

/**
 * O runner respondeu, mas RECUSOU (Docker indisponível na máquina do
 * usuário, especificação inválida, etc.) — `sucesso: false` na resposta do
 * engine. Mesmo raciocínio de `BrokerRecusouError` do lado do broker: a
 * mensagem já vem pronta do runner (`mensagemDeErro`), nunca uma exceção
 * genérica.
 */
export class RunnerRecusouContainerError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'RunnerRecusouContainerError';
  }
}

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

  /**
   * Cancela o turno em curso do agente conversacional (RN-122, o botão
   * "Parar" do composer) — mata a Task que segura a chamada ao LLM no
   * engine, cortando a conexão SSE no meio para economizar token de
   * verdade, não só parar de renderizar no cliente. Idempotente: sem
   * turno em curso (ou sem o agente de pé), é NO-OP no engine.
   */
  abstract cancelAgentTurn(
    projectId: string,
    sessionId: string,
    agent: string,
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

  /**
   * Leitura da flag global `PSYCHOLOGIST_ENABLED` (RN-454) — sem efeito
   * colateral nenhum, ao contrário de `reanalyzeSession`. Existe porque a
   * aba Insights, com zero hipóteses ainda, nunca chega perto do botão
   * "Reanalisar" (só aparece quando há uma rodada de análise para
   * reprocessar) e por isso nunca esbarrava no 503 que denunciava a pausa.
   */
  abstract getPsychologistStatus(): Promise<{ enabled: boolean }>;

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

  /**
   * Pede ao engine um ticket opaco de uso único pro socket `/runner`
   * (`terminal:<projectId>`) — INVERSO do ticket de sessão (RN-108): lá a
   * api insere direto em `session_socket_tickets` (dela, Drizzle); aqui é o
   * engine quem gera e guarda `runner_socket_tickets` (dele, schema
   * "engine"), porque é ele quem PRECISA ler a tabela em `connect/3` e a api
   * não tem acesso de escrita ao schema do engine.
   *
   * `kind: "runner"` é pro CLI na máquina do usuário (no máximo um
   * conectado por projeto); `kind: "terminal"` é pra aba Terminal da web.
   */
  abstract requestRunnerTicket(
    projectId: string,
    userId: string,
    kind: 'runner' | 'terminal',
  ): Promise<{ ticket: string; expiresAt: Date }>;

  /**
   * Pede ao engine para mandar o runner conectado SUBIR o container do
   * projeto (`container_start` num projeto `mounted`/`runner` — PR "o
   * runner sobe o container do projeto na máquina do usuário", ADR 0137).
   * Síncrono, como `executeTerminalAction`: espera a resposta do runner (ou
   * o timeout dele) antes de retornar.
   *
   * Lança `RunnerNaoConectadoError` (sem runner conectado, ou timeout) ou
   * `RunnerRecusouContainerError` (o runner tentou e o Docker DELE recusou)
   * — nunca uma exceção genérica de transporte para esses dois casos, mesma
   * disciplina de `BrokerIndisponivelError`/`BrokerRecusouError` do lado do
   * broker. Qualquer outra falha (HTTP fora do ar, engine derrubado) segue
   * lançando `Error` comum, como o resto deste client.
   */
  abstract startContainerViaRunner(
    projectId: string,
    spec: EspecificacaoDeContainerParaRunner,
  ): Promise<ContainerIniciadoViaRunner>;

  /** Espelho de `startContainerViaRunner` para `container_stop`. */
  abstract stopContainerViaRunner(
    projectId: string,
    workspaceDirName: string,
  ): Promise<void>;

  /** Espelho de `startContainerViaRunner` para `container_remove`. */
  abstract removeContainerViaRunner(
    projectId: string,
    workspaceDirName: string,
  ): Promise<void>;
}
