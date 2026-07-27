import { ACTION_TYPE_LABELS } from './command-matcher';
import type { ActionType } from './decide';

/**
 * Deriva o padrão de match EXATO (sem wildcard) pra uma ação já aprovada —
 * usado por "aprovar sempre" pra gravar em permissions.json. Sem
 * generalização: o próximo `propose` só auto-aprova se mandar o mesmo
 * comando, byte a byte (ver command-matcher.ts).
 */
export function patternForAction(
  actionType: ActionType,
  payload: unknown,
): string {
  const label = ACTION_TYPE_LABELS[actionType];
  if (actionType === 'terminal') {
    return `${label}(${commandFromPayload(payload)})`;
  }
  return `${label}()`;
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
