// "Negação registra para não repropor igual" (Fase 4b, CLAUDE.md 4b.9).
// Puro, sem IO — o chamador (ProposeInstructionPatchUseCase) já carregou
// os conteúdos dos patches NEGADOS a partir das proposed_actions
// (actionType `instruction_patch`, status `denied`), então não há tabela
// nova pra manter em sincronia.

/**
 * Normaliza pra comparação: line endings, espaços à direita de cada
 * linha, linhas em branco nas pontas. Um patch que só difere de um
 * negado por whitespace É o mesmo patch — reproposto ele seria só ruído
 * pro usuário.
 */
export function normalizeInstruction(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

export function isDuplicateOfRejected(
  content: string,
  rejectedContents: string[],
): boolean {
  const normalized = normalizeInstruction(content);
  return rejectedContents.some(
    (rejected) => normalizeInstruction(rejected) === normalized,
  );
}
