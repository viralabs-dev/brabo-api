/**
 * Erro tipado do grafo de conhecimento (Neo4j) — fundação do PROGRAMA de
 * memória derivada (templates de prompt versionados + memória relacional de
 * interações/hipóteses/perfis/handoffs).
 *
 * Mesmo espírito de `domain/llm/llm-provider-errors.ts`: um ponto único que
 * `GraphStore` sempre lança quando o grafo não está disponível — driver não
 * configurado, conexão fora do ar, ou a operação falhou depois do retry.
 * Quem chama (caso de uso ou controller) NUNCA vê um erro cru do
 * `neo4j-driver`; converte este em resposta degradada (503, ou resultado
 * "sem enriquecimento", conforme o consumidor).
 */
export class GraphUnavailableError extends Error {
  constructor(
    message: string,
    /** Erro original do driver — para log, nunca para o cliente HTTP. */
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GraphUnavailableError';
  }
}
