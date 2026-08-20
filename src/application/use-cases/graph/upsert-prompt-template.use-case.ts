import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { PromptVersion } from '../../../domain/graph/graph-types';

export interface UpsertPromptTemplateInput {
  name: string;
  version: string;
  body: string;
  hash: string;
}

export interface UpsertPromptTemplateResult {
  template: PromptVersion;
  /** `false` quando já existia uma versão com o MESMO hash — nada foi criado. */
  created: boolean;
}

/**
 * Grava uma versão de template de prompt, idempotente por HASH
 * (`POST /internal/graph/prompt-templates`, contrato fechado com a frente do
 * engine).
 *
 * ## Por que o hash é a chave de idempotência, não `(name, version)`
 *
 * O chamador (o engine, ou quem semear os prompts) pode reenviar a mesma
 * versão em replay/restart sem saber se ela já foi gravada. Comparar por
 * CONTEÚDO (`hash`) é o que garante que reenviar o mesmo prompt nunca cria
 * uma segunda versão idêntica — é a mesma régua do índice RAG, que também
 * evita reindexar o que não mudou. Se alguém publicar o MESMO `version` com
 * um `body`/`hash` diferente (bug do lado de quem versiona), o comportamento
 * é criar uma versão nova mesmo assim e desativar as anteriores — o Neo4j não
 * tem como saber qual dos dois "v3" é o certo, e recusar silenciosamente
 * esconderia o erro em vez de expô-lo.
 */
@Injectable()
export class UpsertPromptTemplateUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(
    input: UpsertPromptTemplateInput,
  ): Promise<UpsertPromptTemplateResult> {
    return this.graph.executeWrite(async (tx) => {
      const existente = await tx.run(
        `MATCH (t:PromptTemplate {name: $name})-[:HAS_VERSION]->(v:PromptVersion {hash: $hash})
         RETURN v {.*, name: t.name} AS versao`,
        { name: input.name, hash: input.hash },
      );
      if (existente.records.length > 0) {
        return {
          template: registroParaVersao(existente.records[0]),
          created: false,
        };
      }

      const criado = await tx.run(
        `MERGE (t:PromptTemplate {name: $name})
         CREATE (v:PromptVersion {
           version: $version,
           body: $body,
           hash: $hash,
           createdAt: datetime(),
           active: true
         })
         CREATE (t)-[:HAS_VERSION]->(v)
         WITH t, v
         // OPTIONAL MATCH, não MATCH: achado pelo smoke de integração real
         // (a PRIMEIRA versão de um template não tem "old" nenhuma) — um
         // MATCH sem correspondência descarta a linha inteira, e o RETURN
         // abaixo nunca rodava. DISTINCT evita linha duplicada quando HÁ
         // mais de uma versão antiga a desativar (cada uma casaria uma vez).
         OPTIONAL MATCH (t)-[:HAS_VERSION]->(old:PromptVersion)
         WHERE old <> v
         SET old.active = false
         RETURN DISTINCT v {.*, name: t.name} AS versao`,
        {
          name: input.name,
          version: input.version,
          body: input.body,
          hash: input.hash,
        },
      );

      return {
        template: registroParaVersao(criado.records[0]),
        created: true,
      };
    });
  }
}

/**
 * `v {.*, name: t.name}` (projeção de mapa do Cypher) já devolve um objeto
 * plano com todas as propriedades do nó mais o `name` do template pai — sem
 * isso, `PromptVersion.name` não existe na `PromptVersion` (mora só no nó
 * `PromptTemplate`), e teríamos que repassar `input.name` sem confirmar que
 * é o MESMO template que a query casou.
 */
function registroParaVersao(record: {
  get<T = unknown>(key: string): T;
}): PromptVersion {
  const versao = record.get<{
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
