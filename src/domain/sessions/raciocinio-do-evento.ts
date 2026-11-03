import { roleAtLeast, type Role } from '../iam/role';
import type { SessionEvent } from './session-event.entity';

/** Papel mínimo para ver o raciocínio gravado do agente (AT-676, ADR 0248, RN-993). */
export const PAPEL_MINIMO_DO_RACIOCINIO: Role = 'developer';

export function podeVerRaciocinio(papel: Role | null | undefined): boolean {
  return !!papel && roleAtLeast(papel, PAPEL_MINIMO_DO_RACIOCINIO);
}

/**
 * O FILTRO ÚNICO de saída: tira `payload.raciocinio` (e `raciocinioTotal`) de
 * `agent.response` para quem está abaixo de `developer`. Aplicado no ponto de
 * saída das leituras HTTP de evento — o banco guarda o raciocínio inteiro.
 */
export function filtrarRaciocinio<T extends SessionEvent>(
  event: T,
  papel: Role | null | undefined,
): T {
  if (podeVerRaciocinio(papel)) return event;
  if (event.type !== 'agent.response') return event;
  const p = event.payload;
  if (typeof p !== 'object' || p === null || !('raciocinio' in p)) return event;
  const {
    raciocinio: _raciocinio,
    raciocinioTotal: _total,
    ...resto
  } = p as Record<string, unknown>;
  return { ...event, payload: resto };
}

export function filtrarRaciocinioDaLista<T extends SessionEvent>(
  events: T[],
  papel: Role | null | undefined,
): T[] {
  return podeVerRaciocinio(papel)
    ? events
    : events.map((e) => filtrarRaciocinio(e, papel));
}
