/**
 * Publishers/orgs do Hugging Face Hub conhecidos como oficiais (a fabricante
 * do modelo, não um reupload de terceiro).
 *
 * Mesmo espírito de `model-uses.ts`: vocabulário FECHADO e curado à mão, não
 * uma heurística sobre o nome do repo. "Ativar modelo descoberto
 * automaticamente" já é proibido para o catálogo (ADR 0042) — aqui a mesma
 * régua vale para o SELO "oficial": um selo que qualquer publisher pudesse
 * conquistar sozinho (ex.: casar substring do nome) seria tão inútil quanto
 * nenhum selo, porque é exatamente o publisher malicioso quem escolheria um
 * nome parecido.
 *
 * Lista curta e deliberada — cresce por revisão manual, nunca por
 * descoberta automática. Cada entrada aqui é uma org que este código
 * reconhece como a fabricante de fato do modelo que ela publica.
 */
export const HUGGINGFACE_OFFICIAL_PUBLISHERS = [
  'meta-llama',
  'google',
  'mistralai',
  'microsoft',
  'Qwen',
  'deepseek-ai',
  'openai',
  'nvidia',
] as const;

export type HuggingFaceOfficialPublisher =
  (typeof HUGGINGFACE_OFFICIAL_PUBLISHERS)[number];

/**
 * `repoId` no formato `<publisher>/<modelo>` do Hub. O publisher é
 * case-sensitive no Hub de verdade (`Qwen`, não `qwen`) — comparar exato em
 * vez de normalizar caixa evita que um reupload com o nome em minúsculas
 * (`qwen/algo`, que não é a org oficial) ganhe o selo por acidente.
 */
export function isOfficialPublisher(repoId: string): boolean {
  const publisher = repoId.split('/')[0];
  return (HUGGINGFACE_OFFICIAL_PUBLISHERS as readonly string[]).includes(
    publisher,
  );
}
