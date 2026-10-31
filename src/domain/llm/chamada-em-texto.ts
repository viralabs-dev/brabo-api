/**
 * AT-633 (RN-949): o modelo escreveu a chamada de ferramenta COMO TEXTO
 * (`<invoke name="...">`), em vez de usar o canal de `tool_calls`. Devolve o
 * trecho do marcador achado, ou `null`. Função pura; só vale quando a chamada
 * levou `tools` e a resposta veio sem `toolCalls` (quem chama confere).
 *
 * Não casa: bloco cercado, código inline, prosa, nome que não é ferramenta.
 * O JSON solto `{"name","arguments"}` segue com o ToolCallRecovery (ADR 0020).
 */
export function marcacaoDeChamadaEmTexto(
  texto: string,
  nomesDasFerramentas: readonly string[],
): string | null {
  if (nomesDasFerramentas.length === 0) return null;
  const limpo = texto.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const f = limpo.match(/<(?:antml:)?function_calls\b/i);
  if (f) return f[0];
  const nomes = new Set(nomesDasFerramentas);
  for (const m of limpo.matchAll(
    /<(?:antml:)?invoke\s+name\s*=\s*["']([^"']+)["']/gi,
  )) {
    if (nomes.has(m[1])) return m[0];
  }
  for (const m of limpo.matchAll(
    /<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/gi,
  )) {
    try {
      const nome = (JSON.parse(m[1]) as { name?: unknown }).name;
      if (typeof nome === 'string' && nomes.has(nome)) return '<tool_call>';
    } catch {
      // JSON inválido não é marcador.
    }
  }
  return null;
}

/** Quantos caracteres do fim do texto podem ser início de marcador (o stream os retém). */
export function caudaQuePodeSerMarcador(texto: string): number {
  const i = texto.lastIndexOf('<');
  return i >= 0 && texto.length - i <= 40 && !texto.slice(i).includes('>')
    ? texto.length - i
    : 0;
}
