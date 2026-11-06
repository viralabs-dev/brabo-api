import type { Session } from 'neo4j-driver';

/**
 * RN-1030: nodes whose natural key got a uniqueness constraint after graphs
 * were already installed. `CREATE CONSTRAINT` fails on a graph that holds two
 * nodes with the same key, so the bootstrap merges them first.
 */
export const NOS_DEDUPLICAVEIS: readonly {
  label: string;
  chave: readonly string[];
}[] = [
  { label: 'Handoff', chave: ['sessionId', 'seq'] },
  { label: 'Hipotese', chave: ['id'] },
  { label: 'Evento', chave: ['sessionId', 'seq'] },
  { label: 'PerfilAnamnese', chave: ['userId', 'dimensao'] },
];

// Groups of nodes with the same key, the oldest (lowest elementId) first, so
// every statement of one run picks the same keeper.
function grupos(label: string, chave: readonly string[]): string {
  const chaves = chave.map((c) => `n.${c} AS ${c}`).join(', ');
  const nulos = chave.map((c) => `n.${c} IS NOT NULL`).join(' AND ');
  return `MATCH (n:\`${label}\`) WHERE ${nulos}
     WITH n ORDER BY elementId(n)
     WITH ${chaves}, collect(n) AS ns WHERE size(ns) > 1
     WITH head(ns) AS keep, tail(ns) AS dups`;
}

/**
 * Merges duplicated nodes into the oldest one, moving every edge to it, and
 * returns how many nodes were removed. Idempotent: with no duplicate it
 * changes nothing. Only counts are logged by the caller, never node content.
 */
export async function deduplicarNos(
  session: Session,
  nos: typeof NOS_DEDUPLICAVEIS = NOS_DEDUPLICAVEIS,
): Promise<number> {
  let removidos = 0;
  for (const { label, chave } of nos) {
    const base = grupos(label, chave);
    removidos += await session.executeWrite(async (tx) => {
      for (const [de, para] of [
        [
          (t: string) => `(d)-[r${t}]->(m)`,
          (t: string) => `(keep)-[nova:${t}]->(m)`,
        ],
        [
          (t: string) => `(d)<-[r${t}]-(m)`,
          (t: string) => `(keep)<-[nova:${t}]-(m)`,
        ],
      ] as const) {
        const tipos = await tx.run(
          `${base} UNWIND dups AS d MATCH ${de('')} RETURN DISTINCT type(r) AS tipo`,
        );
        for (const registro of tipos.records) {
          const t = `\`${String(registro.get('tipo')).replaceAll('`', '')}\``;
          await tx.run(
            `${base} UNWIND dups AS d
             MATCH ${de(':' + t)}
             MERGE ${para(t)}
             SET nova += properties(r)
             DELETE r`,
          );
        }
      }
      const res = await tx.run(
        `${base} UNWIND dups AS d DETACH DELETE d RETURN count(d) AS n`,
      );
      return Number(res.records[0]?.get('n') ?? 0);
    });
  }
  return removidos;
}
