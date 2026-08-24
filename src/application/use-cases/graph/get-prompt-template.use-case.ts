import { Injectable, NotFoundException } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { PromptVersion } from '../../../domain/graph/graph-types';

export interface GetPromptTemplateInput {
  name: string;
  /** Omitido = a versão `active` mais recente. */
  version?: string;
}

/**
 * Busca um template de prompt (`GET /internal/graph/prompt-templates/:name`).
 *
 * `version` específica busca por igualdade exata; omitida, busca a versão
 * `active` mais recente por `createdAt` — nunca "a última criada", porque
 * `active` é o que `UpsertPromptTemplateUseCase` mantém coerente (só uma
 * versão ativa por template).
 */
@Injectable()
export class GetPromptTemplateUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: GetPromptTemplateInput): Promise<PromptVersion> {
    const registro = await this.graph.executeRead(async (tx) => {
      if (input.version) {
        const resultado = await tx.run(
          `MATCH (t:PromptTemplate {name: $name})-[:HAS_VERSION]->(v:PromptVersion {version: $version})
           RETURN v {.*, name: t.name} AS versao`,
          { name: input.name, version: input.version },
        );
        return resultado.records[0] ?? null;
      }

      const resultado = await tx.run(
        `MATCH (t:PromptTemplate {name: $name})-[:HAS_VERSION]->(v:PromptVersion {active: true})
         RETURN v {.*, name: t.name} AS versao
         ORDER BY v.createdAt DESC
         LIMIT 1`,
        { name: input.name },
      );
      return resultado.records[0] ?? null;
    });

    if (!registro) {
      throw new NotFoundException(
        input.version
          ? `Template "${input.name}" versão "${input.version}" não encontrado.`
          : `Template "${input.name}" não tem versão ativa.`,
      );
    }

    const versao = registro.get<{
      name: string;
      version: string;
      body: string;
      hash: string;
      createdAt: { toString(): string };
      active: boolean;
    }>('versao');
    return {
      name: versao.name,
      version: versao.version,
      body: versao.body,
      hash: versao.hash,
      createdAt: versao.createdAt.toString(),
      active: versao.active,
    };
  }
}
