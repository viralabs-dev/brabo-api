/**
 * O instrumento de medição da busca do RAG (Parte 2, Etapa 1 — RN-479/480).
 *
 * Uso: pnpm --filter api medir:rag -- --projeto <uuid> [--dias N] [--json]
 *
 * ## Por que ele existe
 *
 * `domain/rag/rag-search-limits.ts` declara, no próprio comentário, que
 * **nenhum** dos quatro números da busca híbrida (os dois pesos, o limiar e o
 * número de candidatos) vem de calibração com dado real. Não vinha porque não
 * havia como: a busca não deixava rastro nenhum — zero linha de tabela, zero
 * evento. Calibrar sem medir seria trocar um chute por outro.
 *
 * As tabelas `rag_searches`/`rag_feedback` são o rastro; este script é a
 * leitura dele. Ele mede o que houver no projeto que receber, para servir a
 * qualquer janela — inclusive passada. **Ele não calibra nada**, e mudar os
 * números por causa do que ele mostra é uma decisão de produto separada.
 *
 * ## O que ele mede, e por que cada uma
 *
 * | métrica | responde |
 * |---|---|
 * | `precision@k` por feedback | a busca ACERTOU? (latência e degradação só dizem se ela RODOU) |
 * | taxa de `degraded` | quantas buscas rodaram sem a metade semântica |
 * | buscas sem NENHUM hit acima do limiar | o limiar está cortando tudo, ou o índice não cobre |
 * | latência p50/p95 | a busca cabe no turno de um agente |
 * | distribuição de RANK do que foi votado útil | os PESOS estão errados, ou o índice está pobre |
 *
 * A última é a que mais importa e a mais fácil de esquecer: um índice pobre
 * não devolve o trecho certo em posição nenhuma; um peso errado devolve o
 * trecho certo em rank 7. As duas doenças têm `precision@1` ruim e tratamento
 * oposto.
 *
 * ## Critério (é por isso que ele sai != 0)
 *
 * Uma coisa só não é relatório, é reprovação: **`vector_available: false` na
 * janela INTEIRA**. Sem índice denso, o que foi medido não foi a busca
 * híbrida — foi a metade léxica dela, e calibrar peso de vetor a partir disso
 * seria calibrar contra um sistema que não é o que roda. O resto é medição:
 * sai na tabela, não reprova.
 *
 * ## O que ele NÃO faz, declarado
 *
 * Ele não compara pesos entre si. `rag_searches.pesos` guarda os pesos
 * CONGELADOS de cada busca (mesma disciplina do preço congelado no metering,
 * ADR 0042) justamente para que essa comparação seja possível DEPOIS que a
 * calibração mudar os números — mas enquanto todas as linhas têm os mesmos
 * pesos, comparar não diria nada. O script IMPRIME quais pesos apareceram na
 * janela, para que a mistura fique visível quando ela existir.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import {
  DRIZZLE,
  type DrizzleDb,
} from '../src/infrastructure/persistence/drizzle/drizzle-client';
import { projects, ragFeedback, ragSearches } from '../src/db/schema';
import type {
  RagSearchHitTelemetry,
  RagSearchWeights,
  RagVerdict,
} from '../src/domain/rag/rag-telemetry';

const DIAS_PADRAO = 30;

/** Os `k` reportados. Não é configurável: mudar a régua entre medições impede comparar. */
export const KS: readonly number[] = [1, 3, 5, 10];

interface Opcoes {
  projeto: string;
  dias: number;
  json: boolean;
}

function lerOpcoes(): Opcoes {
  const args = process.argv.slice(2);
  const projeto = args[args.indexOf('--projeto') + 1];

  if (!args.includes('--projeto') || !projeto || projeto.startsWith('--')) {
    console.error('uso: medir-rag.ts --projeto <uuid> [--dias N] [--json]');
    process.exit(2);
  }

  let dias = DIAS_PADRAO;
  if (args.includes('--dias')) {
    const bruto = args[args.indexOf('--dias') + 1];
    dias = Number(bruto);
    if (!Number.isInteger(dias) || dias <= 0) {
      console.error('uso: medir-rag.ts --projeto <uuid> [--dias N] [--json]');
      console.error('`--dias` precisa ser um inteiro positivo');
      process.exit(2);
    }
  }

  return { projeto, dias, json: args.includes('--json') };
}

// ---------------------------------------------------------------------------
// Helpers PUROS — exportados para o `.spec.ts` poder cobri-los sem banco.
// ---------------------------------------------------------------------------

/**
 * Percentil pelo método do vizinho mais próximo (índice `ceil(p*n)-1` sobre a
 * lista ordenada). Sem interpolação de propósito: latência é uma observação
 * que aconteceu, e um p95 interpolado é um número que nenhuma busca mediu.
 */
export function percentil(
  valores: readonly number[],
  p: number,
): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const i = Math.max(0, Math.ceil(p * ordenados.length) - 1);
  return ordenados[i];
}

export interface VotoMedido {
  chunkId: string;
  verdict: RagVerdict;
  /** O rank que o trecho tinha NAQUELA busca — vem de `rag_searches.hits`. */
  rank: number;
}

export interface PrecisionAtK {
  k: number;
  /** Votos `util` entre os julgados de rank ≤ k. */
  uteis: number;
  /** TODOS os julgados de rank ≤ k — o denominador honesto. */
  julgados: number;
  /** `null` quando ninguém julgou nada nessa faixa. Nunca 0: 0 significaria "tudo errado". */
  precision: number | null;
}

/**
 * `precision@k` sobre o que foi JULGADO, nunca sobre o que foi devolvido.
 *
 * O denominador é o número de hits votados de rank ≤ k, e não `k`. A diferença
 * é a honestidade da métrica: um hit sem voto é DESCONHECIDO, não irrelevante,
 * e contá-lo como irrelevante faria a precisão despencar sozinha toda vez que
 * alguém votasse em menos trechos — medindo a disposição de votar, não a
 * qualidade da busca.
 *
 * Sem nenhum julgado na faixa, o valor é `null` e a tabela diz "—". Zero e
 * "não medido" não são a mesma coisa, e colapsá-los é o defeito que a RN-088
 * nomeia.
 */
export function precisionAtK(
  votos: readonly VotoMedido[],
  ks: readonly number[] = KS,
): PrecisionAtK[] {
  return ks.map((k) => {
    const naFaixa = votos.filter((v) => v.rank <= k);
    const uteis = naFaixa.filter((v) => v.verdict === 'util').length;
    return {
      k,
      uteis,
      julgados: naFaixa.length,
      precision: naFaixa.length === 0 ? null : uteis / naFaixa.length,
    };
  });
}

/**
 * Quantas vezes cada RANK apareceu entre os trechos votados ÚTEIS.
 *
 * É a métrica que separa dois diagnósticos que a `precision@1` confunde:
 * massa concentrada em rank 1–2 é ordenação boa; massa espalhada até o 8 é
 * PESO errado (o trecho certo está no índice, mas a fusão o coloca embaixo);
 * quase nenhum voto útil em rank nenhum é ÍNDICE pobre.
 */
export function distribuicaoDeRank(
  votos: readonly VotoMedido[],
): { rank: number; uteis: number }[] {
  const porRank = new Map<number, number>();
  for (const voto of votos) {
    if (voto.verdict !== 'util') continue;
    porRank.set(voto.rank, (porRank.get(voto.rank) ?? 0) + 1);
  }
  return [...porRank.entries()]
    .map(([rank, uteis]) => ({ rank, uteis }))
    .sort((a, b) => a.rank - b.rank);
}

/** `12 de 40 (30,0%)` — contagem E proporção, porque uma sozinha engana. */
export function proporcao(parte: number, total: number): string {
  if (total === 0) return '— (nenhuma busca na janela)';
  const pct = ((parte / total) * 100).toFixed(1).replace('.', ',');
  return `${parte} de ${total} (${pct}%)`;
}

/** `0,6/0,4 · limiar 0,2` — a assinatura de um conjunto de pesos, para agrupar. */
export function assinaturaDePesos(pesos: RagSearchWeights): string {
  const n = (v: number) => String(v).replace('.', ',');
  return `${n(pesos.vector)}/${n(pesos.lexical)} · limiar ${n(pesos.threshold)}`;
}

// ---------------------------------------------------------------------------

interface Medida {
  projeto: { id: string; nome: string };
  janela: { desde: string; dias: number };
  buscas: number;
  buscasComSessao: number;
  buscasDaAba: number;
  degradadas: number;
  vazias: number;
  vetorDisponivelNunca: boolean;
  latencia: { p50: number | null; p95: number | null };
  pesosNaJanela: { assinatura: string; buscas: number }[];
  votos: { total: number; uteis: number; irrelevantes: number };
  precision: PrecisionAtK[];
  rankDosUteis: { rank: number; uteis: number }[];
}

async function main() {
  const { projeto, dias, json } = lerOpcoes();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const db = app.get<DrizzleDb>(DRIZZLE);

  const [projetoRow] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projeto));

  if (!projetoRow) {
    console.error(`projeto ${projeto} não existe`);
    await app.close();
    process.exit(2);
  }

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const buscas = await db
    .select()
    .from(ragSearches)
    .where(
      and(
        eq(ragSearches.projectId, projeto),
        gte(ragSearches.createdAt, desde),
      ),
    )
    .orderBy(asc(ragSearches.createdAt));

  if (buscas.length === 0) {
    console.error(
      `projeto ${projetoRow.name} não tem busca de RAG nos últimos ${dias} dia(s) — ` +
        'não há o que medir (a telemetria só existe a partir da RN-479)',
    );
    await app.close();
    process.exit(2);
  }

  // Os votos da janela, já casados com o RANK que o trecho tinha na busca — o
  // rank vem de `rag_searches.hits`, congelado no momento da busca, nunca
  // recalculado agora (recalcular mediria a busca de HOJE, não a que foi
  // julgada).
  const idsDeBusca = buscas.map((b) => b.id);
  const votosCrus = await db
    .select()
    .from(ragFeedback)
    .where(inArray(ragFeedback.searchId, idsDeBusca));

  const hitsPorBusca = new Map<string, RagSearchHitTelemetry[]>(
    buscas.map((b) => [b.id, b.hits]),
  );
  const votos: VotoMedido[] = [];
  for (const voto of votosCrus) {
    const hit = hitsPorBusca
      .get(voto.searchId)
      ?.find((h) => h.chunkId === voto.chunkId);
    // Voto sem hit correspondente não deveria existir (o caso de uso recusa),
    // mas se existisse não teria rank — e voto sem rank não mede nada.
    if (!hit) continue;
    votos.push({
      chunkId: voto.chunkId,
      verdict: voto.verdict,
      rank: hit.rank,
    });
  }

  const pesos = new Map<string, number>();
  for (const busca of buscas) {
    const chave = assinaturaDePesos(busca.pesos);
    pesos.set(chave, (pesos.get(chave) ?? 0) + 1);
  }

  const latencias = buscas.map((b) => b.latencyMs);

  const medida: Medida = {
    projeto: { id: projetoRow.id, nome: projetoRow.name },
    janela: { desde: desde.toISOString(), dias },
    buscas: buscas.length,
    buscasComSessao: buscas.filter((b) => b.sessionId !== null).length,
    buscasDaAba: buscas.filter((b) => b.sessionId === null).length,
    degradadas: buscas.filter((b) => b.degraded).length,
    vazias: buscas.filter((b) => b.hits.length === 0).length,
    vetorDisponivelNunca: buscas.every((b) => !b.vectorAvailable),
    latencia: {
      p50: percentil(latencias, 0.5),
      p95: percentil(latencias, 0.95),
    },
    pesosNaJanela: [...pesos.entries()].map(([assinatura, n]) => ({
      assinatura,
      buscas: n,
    })),
    votos: {
      total: votos.length,
      uteis: votos.filter((v) => v.verdict === 'util').length,
      irrelevantes: votos.filter((v) => v.verdict === 'irrelevante').length,
    },
    precision: precisionAtK(votos),
    rankDosUteis: distribuicaoDeRank(votos),
  };

  if (json) {
    console.log(JSON.stringify(medida, null, 2));
  } else {
    imprimir(medida);
  }

  await app.close();

  // O critério. O resto é medição.
  if (medida.vetorDisponivelNunca) {
    console.error('\n[medir-rag] critério NÃO fechou:');
    console.error(
      `  - nenhuma das ${medida.buscas} buscas da janela teve \`vector_available: true\` — ` +
        'o índice denso esteve fora o tempo todo, e o que foi medido não é a busca híbrida. ' +
        'Confira o daemon de embedding (Ollama, `nomic-embed-text`) e meça de novo.',
    );
    process.exit(1);
  }

  console.log(
    '\n[medir-rag] critério fechado: o índice denso respondeu em ao menos uma busca da janela.',
  );
}

/** Markdown, para a tabela cair no documento de calibração sem redigitação. */
function imprimir(m: Medida) {
  console.log(`# Busca do RAG medida — ${m.projeto.nome}\n`);
  console.log(`- projeto: \`${m.projeto.id}\``);
  console.log(
    `- janela: últimos ${m.janela.dias} dia(s), desde ${m.janela.desde}`,
  );
  console.log(
    `- buscas: **${m.buscas}** (${m.buscasComSessao} de agente, ${m.buscasDaAba} da aba)\n`,
  );

  console.log('## Saúde da busca\n');
  console.log('| medida | valor |');
  console.log('|---|---|');
  console.log(
    `| degradadas (léxico-only) | ${proporcao(m.degradadas, m.buscas)} |`,
  );
  console.log(
    `| sem NENHUM hit acima do limiar | ${proporcao(m.vazias, m.buscas)} |`,
  );
  console.log(
    `| latência p50 | ${m.latencia.p50 === null ? '—' : `${m.latencia.p50} ms`} |`,
  );
  console.log(
    `| latência p95 | ${m.latencia.p95 === null ? '—' : `${m.latencia.p95} ms`} |`,
  );

  console.log('\n## Pesos vigentes na janela\n');
  console.log(
    'Congelados por busca (RN-479). Enquanto houver UMA linha só, comparar pesos ' +
      'não diz nada — a coluna existe para a mistura ficar visível quando a calibração começar.\n',
  );
  console.log('| pesos (vetor/léxico · limiar) | buscas |');
  console.log('|---|---|');
  for (const p of m.pesosNaJanela) {
    console.log(`| ${p.assinatura} | ${p.buscas} |`);
  }

  console.log('\n## `precision@k` — só sobre o que foi JULGADO\n');
  if (m.votos.total === 0) {
    console.log(
      '_nenhum voto na janela: `precision@k` não é 0, é **não medido**. ' +
        'Sem voto, latência e degradação dizem se a busca rodou, nunca se ela acertou._',
    );
  } else {
    console.log(
      `${m.votos.total} voto(s): ${m.votos.uteis} útil(eis), ${m.votos.irrelevantes} irrelevante(s). ` +
        'O denominador é o que foi votado, nunca `k` — um hit sem voto é DESCONHECIDO, não irrelevante.\n',
    );
    console.log('| k | úteis | julgados | precision@k |');
    console.log('|---|---|---|---|');
    for (const p of m.precision) {
      console.log(
        `| ${p.k} | ${p.uteis} | ${p.julgados} | ${p.precision === null ? '— (ninguém julgou nessa faixa)' : p.precision.toFixed(2).replace('.', ',')} |`,
      );
    }
  }

  console.log('\n## Rank do que foi votado ÚTIL\n');
  console.log(
    'Massa em rank 1–2 é ordenação boa. Massa espalhada até o fim é PESO errado ' +
      '(o trecho certo está indexado, a fusão o coloca embaixo). Quase nada em rank ' +
      'nenhum é ÍNDICE pobre — e as duas doenças têm `precision@1` ruim.\n',
  );
  if (m.rankDosUteis.length === 0) {
    console.log('_nenhum voto `util` na janela._');
  } else {
    console.log('| rank | votos úteis |');
    console.log('|---|---|');
    for (const r of m.rankDosUteis) {
      console.log(`| ${r.rank} | ${r.uteis} |`);
    }
  }
}

// Só roda como CLI. Sem esta guarda, importar o módulo no teste dispararia a
// medição inteira — subindo o Nest e derrubando o processo no `process.exit`
// do parser de argumentos.
if (process.argv[1]?.endsWith('medir-rag.ts')) void main();
