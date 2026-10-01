/**
 * Grava os vetores REAIS dos pares de calibração da duplicata semântica
 * (RN-681, ADR 0198) — o insumo de `limiar-de-duplicata.calibracao.spec.ts`.
 *
 * Uso (com o Ollama de pé e o modelo do RAG puxado):
 *
 * ```bash
 * docker exec brabo-dev-ollama-1 ollama pull nomic-embed-text
 * OLLAMA_HOST=http://localhost:11434 \
 *   pnpm --filter api exec ts-node scripts/gravar-vetores-de-duplicata.ts
 * pnpm --filter api test limiar-de-duplicata
 * ```
 *
 * Lê `test/fixtures/duplicata-semantica/pares.json`, vetoriza cada texto UMA
 * vez com o MESMO provider e modelo que a checagem usa em produção
 * (`RAG_EMBEDDING_PROVIDER`/`RAG_EMBEDDING_MODEL`) e escreve `vetores.json` ao
 * lado, com o modelo que o daemon DISSE ter usado e a data. Imprime o cosseno
 * de cada par: é a tabela que decide se o limiar fica, sobe ou desce.
 *
 * Por que script e não teste: gravar exige daemon, e o CI não tem. A prova
 * que roda sempre é sobre o arquivo GRAVADO — vetor de daemon vivo mudaria a
 * cada versão do modelo sem o PR que a trouxe saber.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OllamaProvider } from '../src/infrastructure/llm/ollama-provider';
import { RAG_EMBEDDING_MODEL } from '../src/domain/rag/rag-search-limits';
import {
  LIMIAR_DE_DUPLICATA_SEMANTICA,
  similaridadeCosseno,
} from '../src/domain/backlog/duplicata-semantica';

interface Par {
  origem: string;
  a: string;
  b: string;
}
interface Pares {
  duplicata: Par[];
  distinta: Par[];
}

const PASTA = join(__dirname, '..', 'test', 'fixtures', 'duplicata-semantica');

async function main(): Promise<void> {
  const pares = JSON.parse(
    readFileSync(join(PASTA, 'pares.json'), 'utf8'),
  ) as Pares;
  const textos = [
    ...new Set(
      [...pares.duplicata, ...pares.distinta].flatMap((p) => [p.a, p.b]),
    ),
  ];

  const provider = new OllamaProvider();
  const resultado = await provider.embed(textos, {
    model: RAG_EMBEDDING_MODEL,
  });

  const vetores: Record<string, number[]> = {};
  textos.forEach((t, i) => {
    vetores[t] = [...resultado.vectors[i]];
  });

  writeFileSync(
    join(PASTA, 'vetores.json'),
    JSON.stringify(
      {
        modelo: resultado.model,
        dimensoes: resultado.dimensions,
        gravadoEm: new Date().toISOString(),
        vetores,
      },
      null,
      0,
    ) + '\n',
  );

  for (const [classe, lista] of [
    ['duplicata', pares.duplicata],
    ['distinta', pares.distinta],
  ] as const) {
    for (const p of lista) {
      const cos = similaridadeCosseno(vetores[p.a], vetores[p.b]);
      const lado = cos >= LIMIAR_DE_DUPLICATA_SEMANTICA ? 'AVISA' : 'passa';
      console.log(
        `${classe.padEnd(9)} ${cos.toFixed(3)} ${lado}  ${p.a}  ×  ${p.b}`,
      );
    }
  }
  console.log(
    `\nmodelo ${resultado.model}, ${resultado.dimensions} dimensões, ` +
      `limiar vigente ${LIMIAR_DE_DUPLICATA_SEMANTICA}`,
  );
}

main().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
