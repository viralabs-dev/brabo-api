import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type {
  UserContext,
  UserContextFact,
} from '../../../domain/graph/graph-types';

export interface QueryUserContextInput {
  userId: string;
  projectId: string;
  /** Teto de handoffs recentes devolvidos — leitura contida, mesma régua do resto do produto (ADR 0060). */
  handoffLimit?: number;
  /** Teto de fatos do perfil devolvidos (RN-680) — o total vem junto, em `factsTotal`. */
  factLimit?: number;
}

const HANDOFF_LIMIT_DEFAULT = 10;
export const FACT_LIMIT_DEFAULT = 5;

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
    const factLimit = input.factLimit ?? FACT_LIMIT_DEFAULT;

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

      // RN-680 (ADR 0196): os FATOS do perfil — hipóteses que a pessoa aceitou —
      // escopados ao PROJETO pedido (um fato de outro projeto, talvez de outro
      // workspace, nunca entra aqui), os mais recentes primeiro, com teto, e o
      // total ao lado para quem mostra o recorte dizer que é recorte.
      const fatos = await tx.run(
        `MATCH (f:FatoDoPerfil)-[:SOBRE]->(:Usuario {id: $userId}),
               (f)-[:NO_PROJETO]->(:Projeto {id: $projectId})
         WITH f ORDER BY f.aceitoEm DESC
         WITH collect(f) AS todos
         RETURN size(todos) AS total,
                [x IN todos[0..toInteger($factLimit)] | {
                  hypothesisId: x.hypothesisId, agenteAlvo: x.agenteAlvo,
                  hipotese: x.hipotese, sugestao: x.sugestao, aceitoEm: x.aceitoEm
                }] AS fatos`,
        { userId: input.userId, projectId: input.projectId, factLimit },
      );
      const linhaDeFatos = fatos.records[0];
      const totalDeFatos = linhaDeFatos
        ? Number(linhaDeFatos.get<unknown>('total'))
        : 0;
      const listaDeFatos = linhaDeFatos
        ? linhaDeFatos.get<UserContextFact[]>('fatos')
        : [];

      return {
        facts: listaDeFatos.map((f) => ({
          hypothesisId: String(f.hypothesisId),
          agenteAlvo: String(f.agenteAlvo),
          hipotese: String(f.hipotese),
          sugestao: String(f.sugestao),
          aceitoEm: String(f.aceitoEm),
        })),
        factsTotal: Number.isFinite(totalDeFatos) ? totalDeFatos : 0,
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
