// Regra de linguagem para quem não programa (AT-1021, RN-1526). Pura.
//
// Vale para a CAUSA do bloqueio, os RÓTULOS de ação/opção; nunca para a
// orientação ao dev, o diagnóstico ou o detalhe, que são técnicos de propósito.
// O engine tem a mesma regra e a mesma tabela de casos: aqui é a fronteira de
// confiança, e a falha descarta a explicação em vez de recusar o bloqueio.

export const TETO_DA_CAUSA = 160;
export const TETO_DO_ROTULO = 40;
export const TETO_DA_ORIENTACAO = 2000;
export const TETO_DO_CODIGO = 64;
export const MAX_DE_ACOES = 2;

const PROIBIDOS: ReadonlyArray<[RegExp, string]> = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'UUID'],
  [/\b[0-9a-f]{12,}\b/i, 'hash'],
  [/`/, 'crase'],
  [
    /\S\.(json|lock|ts|js|ex|exs|yml|yaml|md|sql|env)\b|(^|\s)\.env\b/i,
    'nome de arquivo',
  ],
  [/\/[\w.-]+\/|(^|\s)\/[\w.-]+/, 'caminho'],
  [/\b\w+(\.\w+){2,}\b/, 'identificador com pontos'],
  [/\b[a-z0-9]+_[a-z0-9_]+\b/i, 'identificador snake_case'],
  [/\b[a-z]+[A-Z][A-Za-z]*\b/, 'identificador camelCase'],
  [/(^|[\s[(,]):[a-z_]\w*/i, 'átomo'],
  [/\b[A-Z]{2,}_[A-Z0-9_]*\b|\bE[A-Z]{4,}\b/, 'constante'],
  [/\b[\w.-]+:\d{2,5}\b/, 'host:porta'],
  [/\b(?:http|status|código|erro)\s+[1-5]\d{2}\b/i, 'código HTTP'],
];

/** Devolve o motivo da recusa, ou `null` quando a frase é para leigo. */
export function recusaDeFraseParaLeigo(
  texto: unknown,
  teto: number,
): string | null {
  if (typeof texto !== 'string' || texto.trim() === '') return 'texto vazio';
  if (texto.length > teto) return `passa de ${teto} caracteres`;
  if (/\.\s+\S/.test(texto.trim())) return 'mais de uma frase';
  for (const [re, nome] of PROIBIDOS) {
    if (re.test(texto)) return `tem ${nome}`;
  }
  return null;
}
