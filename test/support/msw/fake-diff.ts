/**
 * Diff de linhas para os backends FALSOS de GitHub e GitLab.
 *
 * Existe porque a suite de contrato afirma contagens EXATAS de
 * `additions`/`deletions` no diff de uma PR, e um fake que devolvesse
 * números inventados provaria só que o fake sabe repetir o que o teste
 * espera. Aqui os números saem do mesmo lugar de onde sairiam de verdade:
 * da comparação das duas versões do arquivo.
 *
 * O algoritmo é prefixo/sufixo comum — não é o LCS que o git usa, e num
 * arquivo com blocos reordenados produziria um diff maior que o real. É
 * suficiente e honesto para as fixtures da suite, e a diferença aparece
 * como mais linhas trocadas, nunca como contagem errada do que ele mesmo
 * emitiu: `additions`/`deletions` são contados do texto gerado, então o
 * patch e os números nunca divergem.
 */
export interface ArquivoDoDiff {
  path: string;
  previousPath: string | null;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch: string;
}

function linhas(texto: string): string[] {
  if (texto === '') return [];
  const partes = texto.split('\n');
  // `a\n` vira ['a', ''] — o último vazio é o fim do arquivo, não uma linha.
  if (partes[partes.length - 1] === '') partes.pop();
  return partes;
}

/** Diff unificado de UM arquivo, com um único hunk. */
export function diffUnificado(
  path: string,
  antes: string | undefined,
  depois: string | undefined,
): { patch: string; additions: number; deletions: number } {
  const velhas = linhas(antes ?? '');
  const novas = linhas(depois ?? '');

  let prefixo = 0;
  while (
    prefixo < velhas.length &&
    prefixo < novas.length &&
    velhas[prefixo] === novas[prefixo]
  ) {
    prefixo += 1;
  }

  let sufixo = 0;
  while (
    sufixo < velhas.length - prefixo &&
    sufixo < novas.length - prefixo &&
    velhas[velhas.length - 1 - sufixo] === novas[novas.length - 1 - sufixo]
  ) {
    sufixo += 1;
  }

  const removidas = velhas.slice(prefixo, velhas.length - sufixo);
  const adicionadas = novas.slice(prefixo, novas.length - sufixo);

  const corpo = [
    ...velhas.slice(Math.max(0, prefixo - 3), prefixo).map((l) => ` ${l}`),
    ...removidas.map((l) => `-${l}`),
    ...adicionadas.map((l) => `+${l}`),
    ...velhas
      .slice(velhas.length - sufixo, velhas.length - sufixo + 3)
      .map((l) => ` ${l}`),
  ];

  const cabecalho =
    `diff --git a/${path} b/${path}\n` +
    `--- ${antes === undefined ? '/dev/null' : `a/${path}`}\n` +
    `+++ ${depois === undefined ? '/dev/null' : `b/${path}`}\n` +
    `@@ -${prefixo + 1},${removidas.length} +${prefixo + 1},${adicionadas.length} @@\n`;

  return {
    patch: cabecalho + corpo.join('\n') + '\n',
    additions: adicionadas.length,
    deletions: removidas.length,
  };
}

/**
 * Compara duas árvores (caminho -> conteúdo) e devolve um arquivo por
 * mudança. Sem detecção de renomeação: os backends falsos nunca a
 * exercitam, e fingi-la aqui seria inventar comportamento que a suite não
 * verifica.
 */
export function compararArvores(
  base: Map<string, string>,
  cabeca: Map<string, string>,
): ArquivoDoDiff[] {
  const caminhos = [...new Set([...base.keys(), ...cabeca.keys()])].sort();
  const resultado: ArquivoDoDiff[] = [];

  for (const path of caminhos) {
    const antes = base.get(path);
    const depois = cabeca.get(path);
    if (antes === depois) continue;

    const { patch, additions, deletions } = diffUnificado(path, antes, depois);
    resultado.push({
      path,
      previousPath: null,
      status:
        antes === undefined
          ? 'added'
          : depois === undefined
            ? 'removed'
            : 'modified',
      additions,
      deletions,
      patch,
    });
  }

  return resultado;
}
