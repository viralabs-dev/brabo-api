/**
 * O RECORTE de texto em pedaços (chunking) para o pipeline de indexação do
 * Chat RAG (PROGRAMA 28, Onda 4, frente G2 — ADR 0079/0080).
 *
 * ## Por que os números que seguem, e não outros
 *
 * `CHUNK_TARGET_CHARS = 1200` (~300 tokens em português) mira um trecho do
 * tamanho de "algumas seções de parágrafo" — grande o bastante para carregar
 * uma ideia completa (o que um vetor de embedding precisa para não diluir o
 * sentido entre tópicos não relacionados), pequeno o bastante para a busca
 * devolver uma CITAÇÃO que alguém lê em segundos, não um documento inteiro.
 * `CHUNK_OVERLAP_CHARS = 150` (12,5% do alvo) existe porque um corte exato no
 * meio de uma frase faz o pedaço seguinte perder o antecedente dela — sem
 * sobreposição, uma frase que começa num pedaço e termina no próximo vira
 * ruído nos dois. Os dois números são PONTO DE PARTIDA ajustável, não ciência:
 * não há dado de qualidade de recuperação medido contra eles ainda (nenhuma
 * consulta real rodou por este índice até a Onda 4 escrever isto). Calibrar
 * de verdade pede um corpus de perguntas reais, que este programa não tem.
 *
 * ## Por que corte por PARÁGRAFO/QUEBRA, não por token
 *
 * Contar token exigiria o MESMO tokenizador do modelo de embedding — e
 * `nomic-embed-text` não expõe um pacote de contagem local como o `chat` já
 * tem (`GptTokenizerEstimator`, calibrado para modelos de CHAT). Cortar por
 * caractere, preferindo a quebra de parágrafo mais próxima do alvo, é uma
 * aproximação honesta que não finge uma precisão que não existe.
 */

/** Ver o porquê acima. */
export const CHUNK_TARGET_CHARS = 1200;
export const CHUNK_OVERLAP_CHARS = 150;

/**
 * Janela de busca, para trás do corte bruto, por uma quebra "limpa" (parágrafo
 * ou espaço) antes de aceitar um corte no meio de uma palavra. Curta o
 * bastante para não devolver um pedaço muito menor que o alvo.
 */
const JANELA_DE_CORTE_LIMPO = 200;

export interface TextChunk {
  content: string;
  /** Posição do pedaço dentro do texto de origem (0-based). */
  index: number;
}

/**
 * Recorta um texto em pedaços de ~`CHUNK_TARGET_CHARS`, com
 * `CHUNK_OVERLAP_CHARS` de sobreposição entre um pedaço e o seguinte.
 *
 * Texto que já cabe inteiro no alvo vira UM pedaço só — a maioria das
 * mensagens de sessão e muitas seções de doc não precisam de corte nenhum.
 */
export function chunkText(
  text: string,
  opts: { targetChars?: number; overlapChars?: number } = {},
): TextChunk[] {
  const alvo = opts.targetChars ?? CHUNK_TARGET_CHARS;
  const sobreposicao = opts.overlapChars ?? CHUNK_OVERLAP_CHARS;
  const limpo = text.trim();
  if (limpo.length === 0) return [];
  if (limpo.length <= alvo) return [{ content: limpo, index: 0 }];

  const pedacos: string[] = [];
  let inicio = 0;

  while (inicio < limpo.length) {
    let fim = Math.min(inicio + alvo, limpo.length);
    if (fim < limpo.length) {
      fim = melhorCorte(limpo, inicio, fim);
    }
    const pedaco = limpo.slice(inicio, fim).trim();
    if (pedaco.length > 0) pedacos.push(pedaco);
    if (fim >= limpo.length) break;

    // Garante avanço mesmo se a sobreposição empataria o próximo início com o
    // atual (pedaço menor que a sobreposição, texto patológico).
    const proximoInicio = fim - sobreposicao;
    inicio = proximoInicio > inicio ? proximoInicio : fim;
  }

  return pedacos.map((content, index) => ({ content, index }));
}

/**
 * Procura, para trás a partir de `fimBruto`, uma quebra de parágrafo
 * (`\n\n`) ou de palavra (espaço) dentro de `JANELA_DE_CORTE_LIMPO`. Sem
 * nenhuma das duas na janela, aceita o corte bruto — um texto sem espaço
 * nenhum (ex.: um bloco de código minificado colado na sessão) não trava o
 * pipeline esperando uma quebra que não existe.
 */
function melhorCorte(texto: string, inicio: number, fimBruto: number): number {
  const janelaInicio = Math.max(inicio + 1, fimBruto - JANELA_DE_CORTE_LIMPO);
  const paragrafo = texto.lastIndexOf('\n\n', fimBruto);
  if (paragrafo >= janelaInicio) return paragrafo;

  const espaco = texto.lastIndexOf(' ', fimBruto);
  if (espaco >= janelaInicio) return espaco;

  return fimBruto;
}

export interface MarkdownSection {
  /** Trilha de headings até esta seção — vazia para o texto antes do 1º heading. */
  headingPath: string[];
  content: string;
}

const LINHA_DE_HEADING = /^(#{1,6})\s+(.+)$/;

/**
 * Divide um Markdown em seções por HEADING, preservando a trilha
 * (`# A > ## B > ### C`) de cada uma — é essa trilha que vira `headingPath`
 * na citação (RN-232), a parte de "seção" em "arquivo + seção".
 */
export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const linhas = markdown.split('\n');
  const secoes: MarkdownSection[] = [];
  const pilha: { nivel: number; titulo: string }[] = [];
  let atual: string[] = [];
  let trilhaAtual: string[] = [];

  const fechar = () => {
    const corpo = atual.join('\n').trim();
    if (corpo.length > 0) {
      secoes.push({ headingPath: [...trilhaAtual], content: corpo });
    }
    atual = [];
  };

  for (const linha of linhas) {
    const casamento = LINHA_DE_HEADING.exec(linha);
    if (!casamento) {
      atual.push(linha);
      continue;
    }
    fechar();
    const nivel = casamento[1].length;
    const titulo = casamento[2].trim();
    while (pilha.length > 0 && pilha[pilha.length - 1].nivel >= nivel) {
      pilha.pop();
    }
    pilha.push({ nivel, titulo });
    trilhaAtual = pilha.map((p) => p.titulo);
    atual.push(linha);
  }
  fechar();

  return secoes.length > 0
    ? secoes
    : [{ headingPath: [], content: markdown.trim() }];
}

export interface MarkdownChunk {
  headingPath: string[];
  content: string;
}

/**
 * A composição das duas funções acima: primeiro por SEÇÃO (para a citação
 * saber de qual heading o trecho veio), depois por TAMANHO dentro de cada
 * seção (para nenhum pedaço estourar o alvo).
 */
export function chunkMarkdownDocument(markdown: string): MarkdownChunk[] {
  const secoes = splitMarkdownSections(markdown);
  const resultado: MarkdownChunk[] = [];
  for (const secao of secoes) {
    const pedacos = chunkText(secao.content);
    for (const pedaco of pedacos) {
      resultado.push({
        headingPath: secao.headingPath,
        content: pedaco.content,
      });
    }
  }
  return resultado;
}
