import { quote } from 'shell-quote';
import { ACTION_TYPE_LABELS, parseCommand } from './command-matcher';
import type { ActionType } from './decide';
import { padraoAlcancaTeto } from './external-effect';

/**
 * Os padrões que "Sempre permitir" grava em `permissions.json` para uma ação
 * já aprovada (RN-675, AT-257/AT-170, ponto 6 do ADR 0055, ADR 0189).
 *
 * A UNIDADE é VERBO + SUBCOMANDO, um padrão por SEGMENTO do comando composto
 * — decisão do dono de 01/10. Até aqui o padrão era o comando inteiro, byte a
 * byte: o próximo comando quase nunca era igual (173 cliques no uso real de
 * 29/09), e o composto virava UM padrão cujo conteúdo só casava o PRIMEIRO
 * segmento (`matchesPattern` lê `parseCommand(conteúdo)[0]`), então
 * `cd src && npm test` liberava só `cd src`.
 *
 * O casamento continua o de sempre — prefixo de tokens (`command-matcher.ts`)
 * —, e nada aqui afrouxa os tetos: o clique num comando com efeito externo ou
 * privilegiado é recusado ANTES (`motivoDeRecusaDoSempreAprovar`), e o teto
 * de `decide()` roda depois do arquivo de qualquer forma.
 */
export function patternsForAction(
  actionType: ActionType,
  payload: unknown,
): string[] {
  const label = ACTION_TYPE_LABELS[actionType];
  if (actionType !== 'terminal') return [`${label}()`];

  const unidades = parseCommand(commandFromPayload(payload))
    .map(unidadeDoSegmento)
    .filter((unidade): unidade is string[] => unidade !== null);
  // Nada a gravar (comando vazio, ou só segmentos que alcançam um teto): a
  // lista vazia é a resposta — `Terminal()` não casaria nada e só sujaria o
  // arquivo do usuário.
  return [...new Set(unidades.map((unidade) => `${label}(${quote(unidade)})`))];
}

/**
 * Um SUBCOMANDO é uma palavra: letra no começo, sem `/`, `.`, `=`, glob nem
 * flag — `test`, `status`, `vitest`, `run:ci`. `src/x.ts`, `../lib`, `-la` e
 * `KEY=1` não são.
 */
const SUBCOMANDO = /^[A-Za-z][A-Za-z0-9_:-]*$/;

/**
 * Os tokens da unidade de UM segmento (RN-675):
 *
 * - só o verbo (`ls`) → o verbo;
 * - verbo + palavra (`npm test`, `git status`) → os dois;
 * - verbo + argumento que não é palavra (`cat src/x.ts`, `cd ../lib`) → o
 *   verbo — é a generalização que o dono escolheu, e o escopo de caminho
 *   (ADR 0055) segue limitando ONDE fora do piloto;
 * - verbo + FLAG (`ls -la`, `git -C /x status`) → o segmento EXATO: a forma
 *   com flag é onde verbo, forma e invocação divergem (achados Z/AD), e
 *   generalizar ali seria escolher, de dentro do código, uma das três;
 * - unidade que é PREFIXO de um teto da RN-418 (`git remote`, `gh pr`) → o
 *   segmento EXATO, para que nenhum padrão gravado por clique cubra, por
 *   construção, um `git remote add` ou um `gh pr create`; e se até o segmento
 *   exato é prefixo de um teto (`git` sozinho), NENHUM padrão (`null`) — esse
 *   segmento volta a pedir na próxima vez.
 */
export function unidadeDoSegmento(tokens: string[]): string[] | null {
  const [verbo, segundo] = tokens;
  if (verbo === undefined) return null;

  let unidade: string[];
  if (segundo === undefined) unidade = [verbo];
  else if (SUBCOMANDO.test(segundo)) unidade = [verbo, segundo];
  else if (segundo.startsWith('-')) unidade = tokens;
  else unidade = [verbo];

  if (!padraoAlcancaTeto(unidade)) return unidade;
  return padraoAlcancaTeto(tokens) ? null : tokens;
}

export function commandFromPayload(payload: unknown): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'command' in payload &&
    typeof payload.command === 'string'
  ) {
    return (payload as { command: string }).command;
  }
  return '';
}

/**
 * `cwd` opcional (ex.: o worktree de um dev agent) — quando ausente, o
 * terminal roda no workspace compartilhado do projeto (comportamento default).
 */
export function cwdFromPayload(payload: unknown): string | undefined {
  if (
    payload &&
    typeof payload === 'object' &&
    'cwd' in payload &&
    typeof payload.cwd === 'string'
  ) {
    return (payload as { cwd: string }).cwd;
  }
  return undefined;
}
