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
