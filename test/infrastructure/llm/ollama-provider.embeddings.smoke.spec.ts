import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../../../src/infrastructure/llm/ollama-provider';

/**
 * Smoke MANUAL contra o daemon do Ollama de VERDADE (ADR 0075).
 *
 * É a prova que sustenta o único `embeddings: true` do produto. A suite de
 * contrato exercita o dialeto contra um servidor falso — ela prova que sabemos
 * ler a resposta, não que o endpoint existe e responde assim. Foi essa
 * distinção que custou duas reversões ao vivo no ADR 0043, e é ela que este
 * arquivo fecha para o Ollama.
 *
 * Roda quando há daemon alcançável COM um modelo de embedding puxado — não é
 * o caso do CI, e por isso o describe inteiro é pulado com aviso em vez de
 * falhar. Para rodar de verdade:
 *
 * ```bash
 * docker exec brabo-ollama-1 ollama pull nomic-embed-text
 * OLLAMA_EMBEDDING_SMOKE=1 pnpm --filter api test ollama-provider.embeddings
 * ```
 *
 * Resultado datado em docs/explanation/aceite-providers.md.
 */
const ligado = process.env.OLLAMA_EMBEDDING_SMOKE === '1';
const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const modelo = process.env.OLLAMA_EMBEDDING_TEST_MODEL ?? 'nomic-embed-text';

if (!ligado) {
  console.warn(
    '[smoke] OLLAMA_EMBEDDING_SMOKE não é "1" — o aceite de embedding do ' +
      'Ollama contra o daemon real foi PULADO. Ele exige um daemon ' +
      'alcançável em OLLAMA_HOST com o modelo de embedding já puxado ' +
      `(default: ${modelo}); nada disso existe no CI. Ver ` +
      'docs/explanation/aceite-providers.md.',
  );
}

describe.skipIf(!ligado)(
  'Ollama — aceite de embedding contra o daemon real (manual)',
  () => {
    it(
      'o catálogo declara quem embeda, e o modelo declarado embeda de verdade',
      { timeout: 120_000 },
      async () => {
        const provider = new OllamaProvider();

        // 1) A camada de MODELO sai do catálogo, não de um palpite sobre o
        //    nome — é o `/api/tags` do daemon que responde.
        process.env.OLLAMA_HOST = host;
        const catalogo = await provider.listModels();
        const linha = catalogo.find((m) => m.name.startsWith(modelo));

        expect(
          linha,
          `modelo "${modelo}" não está no daemon — rode ` +
            `\`ollama pull ${modelo}\` antes deste smoke`,
        ).toBeDefined();
        expect(linha!.supportsEmbeddings).toBe(true);
        expect(linha!.embeddingDimensions).toBeGreaterThan(0);

        // 2) E a chamada de verdade devolve o que a camada de provider promete.
        const resultado = await provider.embed(
          ['primeiro trecho', 'segundo trecho'],
          { model: linha!.name, host },
        );

        expect(resultado.vectors).toHaveLength(2);
        expect(resultado.dimensions).toBe(linha!.embeddingDimensions);
        expect(resultado.inputTokens).toBeGreaterThan(0);
        expect(resultado.estimated).toBe(false);
        // Dois textos diferentes não podem produzir o mesmo vetor: seria o
        // sintoma de um modelo que ignora a entrada, e o índice inteiro
        // nasceria inútil sem ninguém perceber.
        expect(resultado.vectors[0]).not.toEqual(resultado.vectors[1]);
      },
    );

    it(
      'modelo de CHAT recusa embedding — as duas camadas são disjuntas',
      { timeout: 120_000 },
      async () => {
        const provider = new OllamaProvider();
        process.env.OLLAMA_HOST = host;

        const chat = (await provider.listModels()).find(
          (m) => m.supportsEmbeddings === false,
        );
        if (!chat) {
          console.warn('[smoke] daemon sem modelo de chat — nada a provar');
          return;
        }

        await expect(
          provider.embed(['trecho'], { model: chat.name, host }),
        ).rejects.toMatchObject({ code: 'upstream' });
      },
    );
  },
);
