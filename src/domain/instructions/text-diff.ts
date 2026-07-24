// Diff de linhas puro (LCS) pros patches de instrução (Fase 4b —
// Anamnese). Sem dependência nova (CLAUDE.md pede justificar libs): o
// formato de saída já é ditado pelo renderer que JÁ existe em
// apps/web/src/components/ApprovalCard.tsx (`{kind, content, lineNo}`),
// são ~60 linhas determinísticas, e o repo favorece funções de domínio
// puras e testadas (module-graph.ts, command-matcher.ts, decide.ts).
//
// `lineNo` é a linha no arquivo NOVO pra 'add'/'ctx' e no ANTIGO pra
// 'del' — é assim que o renderer exibe a numeração ao lado do sinal.

export type DiffLineKind = 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  lineNo?: number;
}

export interface TextDiff {
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

function splitLines(text: string): string[] {
  // `split('\n')` num texto terminado em newline gera um último elemento
  // vazio que não é uma linha de verdade — descarta.
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Tabela LCS clássica (O(n·m) tempo e espaço). As instruções de agente
 * são arquivos de dezenas a poucas centenas de linhas — n·m aqui é
 * trivial, não vale a complexidade de um Myers.
 */
function lcsLengths(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Diff linha-a-linha de `before` pra `after`. Percorre a tabela LCS pra
 * frente, emitindo 'ctx' quando as linhas coincidem e 'del'/'add' quando
 * divergem — a ordem preserva a leitura natural do arquivo.
 */
export function diffLines(before: string, after: string): TextDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  const table = lcsLengths(a, b);

  const lines: DiffLine[] = [];
  let additions = 0;
  let deletions = 0;
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'ctx', content: a[i], lineNo: j + 1 });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push({ kind: 'del', content: a[i], lineNo: i + 1 });
      deletions++;
      i++;
    } else {
      lines.push({ kind: 'add', content: b[j], lineNo: j + 1 });
      additions++;
      j++;
    }
  }

  while (i < a.length) {
    lines.push({ kind: 'del', content: a[i], lineNo: i + 1 });
    deletions++;
    i++;
  }

  while (j < b.length) {
    lines.push({ kind: 'add', content: b[j], lineNo: j + 1 });
    additions++;
    j++;
  }

  return { lines, additions, deletions };
}
