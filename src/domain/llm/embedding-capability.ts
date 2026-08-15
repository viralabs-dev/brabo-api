import type { LLMProviderCapabilities, LLMProviderName } from '@brabo/shared';

/**
 * As DUAS camadas da capability de embedding (ADR 0075), no mesmo desenho que
 * o ADR 0041 estabeleceu para tool calling: o provider é o TETO, o modelo é o
 * que aquele modelo específico sabe. Um modelo nunca é mais rico que o
 * provider — e aqui há uma diferença que vale nomear.
 *
 * Tool calling é GRADIENTE: um modelo que não pede ferramentas ainda conversa.
 * Embedding é EXCLUSÃO: `nomic-embed-text` não responde uma pergunta, e
 * `llama3.2` não devolve vetor (o daemon responde `501 This server does not
 * support embeddings` — verificado ao vivo contra o Ollama 0.32.1). São dois
 * conjuntos disjuntos de modelos, não um subconjunto do outro, e é por isso
 * que a pergunta "este modelo é de embedding?" não cabia em nenhuma das
 * colunas `supports_*` existentes.
 */

/** O PROVIDER não sabe embedar — camada de cima. */
export class ProviderCannotEmbedError extends Error {
  constructor(readonly provider: LLMProviderName) {
    super(
      `O provider "${provider}" não declara a capability \`embeddings\`. ` +
        `Escolha um provider que a declare — a capability só é declarada ` +
        `quando provada por execução, nunca por leitura de documentação.`,
    );
    this.name = 'ProviderCannotEmbedError';
  }
}

/** O MODELO não é de embedding — camada de baixo. */
export class ModelNotFitForEmbeddingError extends Error {
  constructor(
    readonly modelName: string,
    /**
     * `false` = o catálogo disse que este modelo NÃO é de embedding.
     * `undefined` = o catálogo não disse nada, e o produto não adivinha.
     * A mensagem muda porque a ação de quem lê é diferente em cada caso.
     */
    readonly declarado: false | undefined,
  ) {
    super(
      declarado === false
        ? `O modelo "${modelName}" é de chat e não gera embedding. Escolha ` +
            `um modelo de embedding no catálogo.`
        : `O catálogo não diz se "${modelName}" gera embedding. Sincronize o ` +
            `catálogo do provider ou escolha um modelo que declare a ` +
            `capability — ausência de declaração não é permissão.`,
    );
    this.name = 'ModelNotFitForEmbeddingError';
  }
}

/**
 * As duas camadas conferidas de uma vez, na ordem em que falham melhor: o
 * provider primeiro, porque trocar de modelo não resolve provider que não
 * embeda.
 *
 * Recebe o par (provider, modelo) já resolvido em vez das entidades inteiras
 * de propósito — a camada de modelo vive hoje na linha de catálogo
 * (`ModeloDoCatalogo.supportsEmbeddings`), e a coluna persistida em `models`
 * é a migração que a onda consumidora carrega. Um `Pick` estreito faz as duas
 * fontes servirem sem que esta regra precise mudar quando a coluna existir.
 */
export function assertCanEmbed(
  provider: { name: LLMProviderName; capabilities: LLMProviderCapabilities },
  modelo: { name: string; supportsEmbeddings?: boolean },
): void {
  if (!provider.capabilities.embeddings) {
    throw new ProviderCannotEmbedError(provider.name);
  }
  if (modelo.supportsEmbeddings !== true) {
    throw new ModelNotFitForEmbeddingError(
      modelo.name,
      modelo.supportsEmbeddings === false ? false : undefined,
    );
  }
}

/**
 * O inverso, e ele existe pelo mesmo motivo: um modelo de embedding vinculado
 * a um agente derrubaria o ToolLoop com uma falha ilegível do provider. Quem
 * declara `supportsEmbeddings: true` está declarando que NÃO conversa.
 */
export function isEmbeddingOnlyModel(modelo: {
  supportsEmbeddings?: boolean;
}): boolean {
  return modelo.supportsEmbeddings === true;
}
