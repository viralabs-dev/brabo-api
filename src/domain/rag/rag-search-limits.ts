/**
 * Tetos e pesos do pipeline de indexação e da busca híbrida do Chat RAG
 * (PROGRAMA 28, Onda 4, frente G2 — ADR 0079/0080).
 *
 * Mesmo motivo de `domain/git/git-read-limits.ts`: são VALORES, não tipo, e
 * `packages/shared` é 100% tipo por invariante travado
 * (`apps/api/test/packages-shared-so-tipos.spec.ts`).
 */

// ---------------------------------------------------------------------------
// Indexação de docs/ADR (via GitProviderContract, reaproveitando
// ReadProjectCodeUseCase) — mesma família de teto que a busca da aba Code
// (item 34 da FASE 26): sem eles, um repositório com uma árvore `docs/`
// patológica vira um amplificador de tráfego de indexação.
// ---------------------------------------------------------------------------

/** Diretórios percorridos por rodada de indexação — cada um custa `listTree`. */
export const RAG_INDEX_DIR_LIMIT = 200;

/** Arquivos Markdown indexados por rodada — cada um custa `getFileContent`. */
export const RAG_INDEX_FILE_LIMIT = 500;

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * O modelo de embedding fixo do pipeline. `chunks.embedding` é `vector(768)`
 * (RN-222) — a dimensão REAL de `nomic-embed-text`, hoje o único modelo cuja
 * dimensão o schema documenta. Trocar de modelo é migração nova (dimensão
 * diferente), não parâmetro de runtime — por isso é constante, não vindo de
 * catálogo: nenhuma coluna persiste "qual modelo é de embedding" ainda
 * (ADR 0075 deixou isso como trabalho futuro, ver `embedding-capability.ts`).
 */
export const RAG_EMBEDDING_MODEL = 'nomic-embed-text';

/**
 * O único provider hoje que declara `capabilities.embeddings: true`
 * (RN-191). Fixo por constante, não resolvido por catálogo, pelo mesmo
 * motivo do modelo acima.
 */
export const RAG_EMBEDDING_PROVIDER = 'ollama' as const;

/**
 * Textos por chamada a `LLMProvider.embed`. Ollama processa a entrada em
 * lote, mas um lote sem teto faria uma indexação grande (centenas de chunks)
 * virar um único corpo HTTP gigante — e se o daemon cair no meio, tudo o que
 * já teria sido calculado se perderia com ele.
 */
export const RAG_EMBED_BATCH_SIZE = 32;

// ---------------------------------------------------------------------------
// Busca híbrida — pesos e limiar (ADR 0080)
//
// NENHUM dos quatro números abaixo vem de calibração com dado real: não há,
// ainda, um corpo de perguntas reais rodado contra este índice. São PONTO DE
// PARTIDA ajustável, e a razão de cada escolha está documentada — não é
// "ciência", é decisão registrada para poder ser revista com dado depois.
// ---------------------------------------------------------------------------

/**
 * Candidatos que CADA sinal (vetor, léxico) traz antes da fusão. Duas
 * consultas independentes, uma por índice (HNSW para vetor, GIN para
 * léxico) — não uma só com JOIN, para cada sinal aproveitar o índice feito
 * pra ele (ver ADR 0079).
 */
export const RAG_SEARCH_VECTOR_CANDIDATES = 20;
export const RAG_SEARCH_LEXICAL_CANDIDATES = 20;

/** Resultados devolvidos por busca, depois da fusão e do corte pelo limiar. */
export const RAG_SEARCH_RESULT_LIMIT = 10;

/**
 * Pesos da combinação linear `score = wVector*vetor + wLexical*léxico`.
 *
 * Semântica ligeiramente favorecida (0.6 contra 0.4): `ts_rank` normalizado
 * (bit 32, `rank/(rank+1)`) raramente passa de ~0.3 mesmo num casamento
 * forte, enquanto similaridade de cosseno de um par realmente relevante
 * costuma ficar entre 0.5 e 0.85 — as duas escalas NÃO são comparáveis por
 * natureza, e o peso maior do lado vetorial compensa a régua mais curta do
 * léxico sem apagá-lo (um chunk só-léxico ainda pode passar do limiar
 * sozinho). Ver ADR 0080 para a discussão completa.
 */
export const RAG_SEARCH_WEIGHT_VECTOR = 0.6;
export const RAG_SEARCH_WEIGHT_LEXICAL = 0.4;

/**
 * Score combinado mínimo para um trecho aparecer como citação. Abaixo dele,
 * "achamos algo" e "não achamos nada relevante" ficam indistinguíveis para
 * quem lê a resposta — um trecho fraco citado como se fosse forte é pior
 * que nenhuma citação.
 */
export const RAG_SEARCH_SCORE_THRESHOLD = 0.2;
