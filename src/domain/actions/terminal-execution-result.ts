/**
 * Resultado da execução de uma ação `terminal` pelo engine — grava em
 * proposed_actions.execution_result depois de executed/failed. Campos de
 * compressão são estimativas (ver Engine.Actions.TerminalExecutor) e ficam
 * `null` quando o binário `rtk` não está disponível no engine.
 */
export interface TerminalExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  rawBytes: number;
  estimatedTokensRaw: number;
  compressedBytes: number | null;
  estimatedTokensCompressed: number | null;
}
