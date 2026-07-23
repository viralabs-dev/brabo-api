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
  ): Promise<TerminalExecutionResult>;
}
