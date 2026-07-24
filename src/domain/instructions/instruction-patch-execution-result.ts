// Resultado da execução de uma ação `instruction_patch` (Fase 4b —
// Anamnese): a versão NOVA gravada no histórico + o ponteiro `current`
// atualizado. Guardado em proposed_actions.execution_result; a UI linka
// pro histórico de versões do agente.
export interface InstructionPatchExecutionResult {
  agent: string;
  fromVersion: number;
  toVersion: number;
  versionId: string;
  // Se o cache do engine foi invalidado com sucesso — best-effort, uma
  // falha aqui NÃO reprova o patch (o conteúdo já está no banco); só
  // significa que os agentes só pegam a mudança ao reiniciar.
  cacheInvalidated: boolean;
}
