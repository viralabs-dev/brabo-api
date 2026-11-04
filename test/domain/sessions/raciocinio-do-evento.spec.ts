import { describe, expect, it } from 'vitest';
import {
  filtrarRaciocinio,
  filtrarRaciocinioDaLista,
} from '../../../src/domain/sessions/raciocinio-do-evento';
import type { SessionEvent } from '../../../src/domain/sessions/session-event.entity';

type Carga = { raciocinio?: string };

// AT-676 (RN-993): `payload.raciocinio` só para developer ou mais.
const evento = (type = 'agent.response'): SessionEvent => ({
  id: 'e',
  sessionId: 's',
  seq: 1,
  type,
  actor: { kind: 'agent', id: 'criativo' },
  payload: { content: 'oi', raciocinio: 'segredo', raciocinioTotal: 7 },
  createdAt: new Date(),
});

describe('filtrarRaciocinio', () => {
  it('viewer não recebe raciocinio; o resto do payload fica', () => {
    const e = filtrarRaciocinio(evento(), 'viewer');
    expect(e.payload).toEqual({ content: 'oi' });
  });
  it('papel ausente também não recebe', () => {
    expect(filtrarRaciocinio(evento(), undefined).payload).toEqual({
      content: 'oi',
    });
  });
  it.each(['developer', 'maintainer', 'owner'] as const)(
    '%s recebe',
    (papel) => {
      expect(
        (filtrarRaciocinio(evento(), papel).payload as Carga).raciocinio,
      ).toBe('segredo');
    },
  );
  it('outro tipo de evento não é tocado; a lista filtra item a item', () => {
    const outro = evento('chat.message');
    expect(filtrarRaciocinio(outro, 'viewer')).toBe(outro);
    const lista = filtrarRaciocinioDaLista([evento(), outro], 'viewer');
    expect((lista[0].payload as Carga).raciocinio).toBeUndefined();
  });
  it('não muta o evento original', () => {
    const e = evento();
    filtrarRaciocinio(e, 'viewer');
    expect((e.payload as Carga).raciocinio).toBe('segredo');
  });
});
