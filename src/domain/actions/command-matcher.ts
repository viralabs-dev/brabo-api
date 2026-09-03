import { parse as shellParse } from 'shell-quote';
import type { ActionType } from './decide';

// Preserva "$VAR" literal em vez de deixar o shell-quote expandir pra ''
// (comportamento padrão dele sem um env real) — perder a variável mudaria
// silenciosamente o que está sendo casado.
const PRESERVE_ENV_VARS = (key: string) => `$${key}`;

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  terminal: 'Terminal',
  git_commit: 'GitCommit',
  git_push: 'GitPush',
  pr_open: 'PrOpen',
  spend: 'Spend',
  git_repo_create: 'GitRepoCreate',
  git_branch_create: 'GitBranchCreate',
  git_branch_protect: 'GitBranchProtect',
  write_file: 'WriteFile',
  open_adr_pr: 'OpenAdrPr',
  git_merge: 'GitMerge',
  open_infra_pr: 'OpenInfraPr',
  instruction_patch: 'InstructionPatch',
  parallelize: 'Parallelize',
  raise_max_parallel: 'RaiseMaxParallel',
  propose_execution_plan: 'ProposeExecutionPlan',
  assess_implementability: 'AssessImplementability',
  container_start: 'ContainerStart',
};

/**
 * Operadores que ENCADEIAM comandos. Só estes quebram segmento, porque só
 * estes introduzem um comando novo — que é o que "comando composto exige
 * aprovação de cada parte" quer dizer.
 */
const OPERADORES_DE_COMANDO = new Set(['&&', '||', ';', '|', '&']);

/**
 * Divide um comando em segmentos por operador que ENCADEIA comandos (&&, ;,
 * |, ||, &) — cada segmento é a lista de tokens (glob "*.js" vira o próprio
 * padrão, não uma string opaca). Comando sem operador retorna 1 segmento só.
 * Base de "comando composto exige aprovação de cada parte".
 *
 * **Redirecionamento (`>`, `>>`, `<`) NÃO quebra segmento.** Ele não
 * introduz comando nenhum: `cat x 2>/dev/null` é UM comando cujo verbo é
 * `cat`. Tratá-lo como separador criava um segmento fantasma `["/dev/null"]`,
 * cujo "verbo" era o próprio caminho — e como composto exige TODO segmento
 * liberado, qualquer comando com redirecionamento virava
 * `require_approval`. Como `2>/dev/null` é idiomático, isso na prática
 * tornava a autonomia inútil (achado AC da FASE 13b).
 *
 * O alvo do redirecionamento continua como TOKEN do segmento, de propósito:
 * é assim que `echo x > /etc/passwd` segue sendo pego pelo teto de escopo
 * (RN-075), que olha os tokens de caminho. A mudança torna o VERBO correto
 * sem afrouxar o caminho.
 */
export function parseCommand(command: string): string[][] {
  const parsed = shellParse(command, PRESERVE_ENV_VARS);
  const segments: string[][] = [];
  let current: string[] = [];

  for (const entry of parsed) {
    const token = tokenOf(entry);

    if (token !== null) {
      current.push(token);
      continue;
    }

    // Operador. Só encadeamento fecha o segmento; redirecionamento é
    // ignorado como token e o alvo cai no MESMO segmento.
    if (encadeiaComando(entry) && current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  return segments.length > 0 ? segments : [[]];
}

function encadeiaComando(entry: unknown): boolean {
  if (entry && typeof entry === 'object' && 'op' in entry) {
    return OPERADORES_DE_COMANDO.has(String(entry.op));
  }
  // Construção desconhecida: trata como quebra, que é o lado conservador —
  // um segmento a mais só pode gerar aprovação, nunca auto-aprovação.
  return true;
}

function tokenOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && 'pattern' in entry) {
    return (entry as { pattern: string }).pattern;
  }
  return null; // operador de shell (&&, ;, |, >, ...) ou construção especial
}

/**
 * Casa um padrão de permissions.json ("Terminal(pnpm test:*)") contra uma
 * ação. Pro tipo `terminal`, casa por PREFIXO dos tokens já parseados do
 * comando (nunca regex na string crua); demais tipos casam pelo padrão
 * exato "Tipo()", sem conteúdo.
 */
export function matchesPattern(
  pattern: string,
  actionType: ActionType,
  commandTokens?: string[],
): boolean {
  const parsed = parsePatternLabel(pattern);
  if (!parsed) return false;
  if (parsed.label !== ACTION_TYPE_LABELS[actionType]) return false;

  if (actionType === 'terminal') {
    if (!commandTokens) return false;
    const patternTokens = parseCommand(parsed.content)[0] ?? [];
    return matchesTokenPrefix(patternTokens, commandTokens);
  }

  return parsed.content.trim() === '';
}

function parsePatternLabel(
  pattern: string,
): { label: string; content: string } | null {
  const match = /^([A-Za-z]+)\((.*)\)$/s.exec(pattern.trim());
  if (!match) return null;
  return { label: match[1], content: match[2] };
}

function matchesTokenPrefix(
  patternTokens: string[],
  commandTokens: string[],
): boolean {
  if (patternTokens.length === 0) return false;
  if (patternTokens.length > commandTokens.length) return false;

  return patternTokens.every((patternToken, i) => {
    const token = commandTokens[i];
    return patternToken.endsWith('*')
      ? token.startsWith(patternToken.slice(0, -1))
      : token === patternToken;
  });
}
