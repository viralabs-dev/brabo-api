import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { UserContext } from '../../../domain/graph/graph-types';

export interface QueryUserContextInput {
  userId: string;
  projectId: string;
  /** Teto de handoffs recentes devolvidos — leitura contida, mesma régua do resto do produto (ADR 0060). */
  handoffLimit?: number;
}

const HANDOFF_LIMIT_DEFAULT = 10;

/**
 * Composição de leitura para "o que o grafo sabe sobre este usuário neste
 * projeto": hipóteses ativas com evidência + perfil de proficiência + últimos
 * handoffs das sessões em que ele participou.
 *
 * Não sofisticado de propósito (a fundação não tem consumidor real ainda —
 * ver CLAUDE.md, seção desta frente): três leituras separadas dentro da MESMA
 * transação, compostas em TS. Hipótese e Handoff não têm relação direta com
 * `Usuario`/`Projeto` no schema — a ponte é sempre `Interacao`
 * (`Usuario -[:PARTICIPOU]-> Interacao -[:NO_PROJETO]-> Projeto`,
 * `Interacao.sessionId` casando com `Evento.sessionId`/`Handoff.sessionId`).
 */
@Injectable()
export class QueryUserContextUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: QueryUserContextInput): Promise<UserContext> {
    const limit = input.handoffLimit ?? HANDOFF_LIMIT_DEFAULT;

    return this.graph.executeRead(async (tx) => {
      const hipoteses = await tx.run(
        `MATCH (u:Usuario {id: $userId})-[:PARTICIPOU]->(i:Interacao)-[:NO_PROJETO]->(:Projeto {id: $projectId})
         MATCH (h:Hipotese {status: 'ativa'})-[:EVIDENCIA]->(e:Evento {sessionId: i.sessionId})
         WITH h, collect(DISTINCT e.seq) AS evidenceSeqs
         RETURN h.id AS id, h.descricao AS descricao, h.status AS status, evidenceSeqs`,
        { userId: input.userId, projectId: input.projectId },
      );

      const perfis = await tx.run(
        `MATCH (p:PerfilAnamnese)-[:SOBRE]->(:Usuario {id: $userId})
         RETURN p.dimensao AS dimensao, p.proficiencia AS proficiencia`,
        { userId: input.userId },
      );

      const handoffs = await tx.run(
        `MATCH (u:Usuario {id: $userId})-[:PARTICIPOU]->(i:Interacao)-[:NO_PROJETO]->(:Projeto {id: $projectId})
         MATCH (h:Handoff {sessionId: i.sessionId})-[:DE]->(de:Agente), (h)-[:PARA]->(para:Agente)
         RETURN h.sessionId AS sessionId, h.seq AS seq, de.slug AS fromAgent, para.slug AS toAgent
         ORDER BY h.seq DESC
         LIMIT toInteger($limit)`,
        { userId: input.userId, projectId: input.projectId, limit },
      );

      return {
        hypotheses: hipoteses.records.map((r) => ({
          id: r.get<string>('id'),
          descricao: r.get<string>('descricao'),
          status: r.get<string>('status'),
          evidenceSeqs: r.get<number[]>('evidenceSeqs'),
        })),
        profiles: perfis.records.map((r) => ({
          dimensao: r.get<string>('dimensao'),
          proficiencia: r.get<string>('proficiencia'),
        })),
        recentHandoffs: handoffs.records.map((r) => ({
          sessionId: r.get<string>('sessionId'),
          seq: r.get<number>('seq'),
          fromAgent: r.get<string>('fromAgent'),
          toAgent: r.get<string>('toAgent'),
        })),
      };
    });
  }
}
