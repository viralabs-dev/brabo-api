import { Injectable, NotFoundException } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';

export interface ImpactoDoModulo {
  projectId: string;
  modulo: string;
  stack: string | null;
  commit: string | null;
  /** Versão do contrato gravada na projeção (vem do banco); `null` sem contrato declarado. */
  contratoVersao: number | null;
  /** Módulos que dependem dele (quem consome). */
  dependentes: string[];
  /** Módulos de que ele depende. */
  dependeDe: string[];
  expoe: { assinatura: string; tipo: string | null }[];
  decisoes: { id: string; titulo: string }[];
}

/**
 * Consulta de impacto de um módulo pelo grafo (RN-1166). Leitura CONTIDA
 * (ADR 0060): escopo no projeto, chave natural, sem parâmetro livre. Grafo
 * desligado lança `GraphUnavailableError` (503), nunca uma lista vazia que
 * pareça verdade; módulo sem nó é 404.
 */
@Injectable()
export class ConsultarImpactoDoModuloUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(projectId: string, modulo: string): Promise<ImpactoDoModulo> {
    const p = { projectId, modulo };
    const r = await this.graph.executeRead(async (tx) => {
      const no = await tx.run(
        `MATCH (m:Modulo {projectId: $projectId, nome: $modulo})
         OPTIONAL MATCH (m)-[:TEM_CONTRATO]->(c:Contrato)
         RETURN m.stack AS stack, m.commit AS commit, max(c.versao) AS versao`,
        p,
      );
      if (no.records.length === 0) return null;
      const lista = async (cypher: string) =>
        (await tx.run(cypher, p)).records.map((x) => x.get<unknown>('x'));
      return {
        no: no.records[0],
        dependentes: await lista(
          `MATCH (d:Modulo)-[:DEPENDE_DE]->(:Modulo {projectId: $projectId, nome: $modulo})
           RETURN d.nome AS x ORDER BY x`,
        ),
        dependeDe: await lista(
          `MATCH (:Modulo {projectId: $projectId, nome: $modulo})-[:DEPENDE_DE]->(d:Modulo)
           RETURN d.nome AS x ORDER BY x`,
        ),
        expoe: await lista(
          `MATCH (:Modulo {projectId: $projectId, nome: $modulo})-[:EXPOE]->(i:Interface)
           RETURN {assinatura: i.assinatura, tipo: i.tipo} AS x ORDER BY i.assinatura`,
        ),
        decisoes: await lista(
          `MATCH (d:Decisao)-[:CITA]->(:Modulo {projectId: $projectId, nome: $modulo})
           RETURN {id: d.id, titulo: d.titulo} AS x ORDER BY d.id`,
        ),
      };
    });
    if (!r) {
      throw new NotFoundException(
        `Módulo "${modulo}" não está na memória do grafo deste projeto.`,
      );
    }
    const versao = r.no.get<unknown>('versao');
    return {
      projectId,
      modulo,
      stack: r.no.get<string | null>('stack') ?? null,
      commit: r.no.get<string | null>('commit') ?? null,
      contratoVersao:
        versao === null || versao === undefined ? null : Number(versao),
      dependentes: r.dependentes as string[],
      dependeDe: r.dependeDe as string[],
      expoe: r.expoe as ImpactoDoModulo['expoe'],
      decisoes: r.decisoes as ImpactoDoModulo['decisoes'],
    };
  }
}
