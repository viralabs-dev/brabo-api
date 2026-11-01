/**
 * Preço de tabela do FABRICANTE (AT-640, RN-965): tabela CURADA à mão, mesmo
 * molde de `huggingface-official-publishers.ts` — lista fechada, cresce por PR
 * que copia da página oficial e troca `conferidoEm`. Nunca raspagem, e sem
 * linha o modelo fica "sem sugestão", nunca com número inventado.
 *
 * O casamento com o id do provider é por IGUALDADE exata em `ids` (o spec
 * reprova id em duas linhas). Velhice não reprova CI; a tela mostra a data.
 */
export interface PrecoDoFabricante {
  fabricante: string;
  modelo: string;
  ids: readonly string[];
  /** micro-USD por 1M de tokens. */
  entradaMicros: number;
  saidaMicros: number;
  fonte: string;
  /** AAAA-MM-DD. */
  conferidoEm: string;
  observacao?: string;
}

/** Domínios aceitos como fonte, por fabricante (o spec confere). */
export const DOMINIOS_DA_FONTE: Record<string, readonly string[]> = {
  Anthropic: ['docs.claude.com', 'platform.claude.com', 'anthropic.com'],
};

const FONTE_ANTHROPIC =
  'https://docs.claude.com/en/docs/about-claude/pricing.md';
const CONFERIDO = '2026-11-01';

function claude(
  modelo: string,
  ids: string[],
  entradaUsd: number,
  saidaUsd: number,
  observacao?: string,
): PrecoDoFabricante {
  return {
    fabricante: 'Anthropic',
    modelo,
    ids,
    entradaMicros: Math.round(entradaUsd * 1_000_000),
    saidaMicros: Math.round(saidaUsd * 1_000_000),
    fonte: FONTE_ANTHROPIC,
    conferidoEm: CONFERIDO,
    ...(observacao ? { observacao } : {}),
  };
}

// Conferido em 01/11/2026 na tabela "Model pricing" da página (colunas
// Base Input / Output). Só entra o que está nela.
export const PRECOS_DO_FABRICANTE: readonly PrecoDoFabricante[] = [
  claude('Claude Opus 5.5', ['claude-opus-5-5', 'claude-opus-5.5'], 4, 20),
  claude('Claude Opus 5', ['claude-opus-5'], 5, 25),
  claude(
    'Claude Opus 4.5',
    ['claude-opus-4-5-20251101', 'claude-opus-4-5'],
    5,
    25,
  ),
  claude(
    'Claude Sonnet 5.5',
    ['claude-sonnet-5-5', 'claude-sonnet-5.5'],
    2,
    10,
  ),
  claude(
    'Claude Sonnet 4.5',
    ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-5'],
    3,
    15,
  ),
  claude(
    'Claude Haiku 5.5',
    ['claude-haiku-5-5', 'claude-haiku-5.5'],
    0.1,
    0.5,
    'Prompt até 100.000 tokens; acima disso US$ 0,50 / 2,50 por 1M.',
  ),
  claude(
    'Claude Haiku 4.5',
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'claude-haiku-4.5'],
    1,
    5,
  ),
];

export function precoDoFabricante(id: string): PrecoDoFabricante | null {
  return PRECOS_DO_FABRICANTE.find((p) => p.ids.includes(id)) ?? null;
}
