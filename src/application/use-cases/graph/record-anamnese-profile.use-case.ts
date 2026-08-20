import { Injectable } from '@nestjs/common';
import { GraphStore } from '../../../infrastructure/graph/graph-store';
import type { AnamneseProfileRecord } from '../../../domain/graph/graph-types';

/**
 * Registra/atualiza um perfil de proficiência da Anamnese:
 * `(:PerfilAnamnese {userId, dimensao})-[:SOBRE]->(:Usuario)`.
 *
 * ## Chave natural: `(userId, dimensao)`, exatamente como o schema pede
 *
 * Um perfil é um SNAPSHOT atual, não um histórico — igual ao que
 * `RecordProficiencyUseCase` já faz no Postgres (`proficiency_profiles`
 * upserta por competência). `SET` sobrescreve `proficiencia` a cada chamada:
 * reprocessar o mesmo evento converge para o mesmo valor final; processar uma
 * rodada NOVA da Anamnese substitui a anterior, que é o comportamento
 * desejado (o grafo reflete o perfil VIGENTE, não uma linha do tempo dele).
 */
@Injectable()
export class RecordAnamneseProfileUseCase {
  constructor(private readonly graph: GraphStore) {}

  async execute(input: AnamneseProfileRecord): Promise<void> {
    await this.graph.executeWrite(async (tx) => {
      await tx.run(
        `MERGE (u:Usuario {id: $userId})
         MERGE (p:PerfilAnamnese {userId: $userId, dimensao: $dimensao})
         SET p.proficiencia = $proficiencia
         MERGE (p)-[:SOBRE]->(u)`,
        {
          userId: input.userId,
          dimensao: input.dimensao,
          proficiencia: input.proficiencia,
        },
      );
    });
  }
}
