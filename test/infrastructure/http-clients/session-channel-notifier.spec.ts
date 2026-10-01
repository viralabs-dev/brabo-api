import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpSessionChannelNotifier,
  urlDoAvisoDeEvento,
} from '../../../src/infrastructure/http-clients/session-channel-notifier';

/**
 * AT-344: o `sessionId` vira segmento da URL do aviso ao engine
 * (`POST /internal/sessions/:id/event-appended`, RN-579). O host vem do
 * `ENGINE_URL`; o segmento nunca pode tirar a chamada da rota.
 */

const ENGINE = 'http://engine:4000';
const ID = '3f2b8c1e-7a4d-4e9b-9c2a-1b2c3d4e5f60';

describe('urlDoAvisoDeEvento', () => {
  it('caminho feliz: UUID vira a rota esperada, na origem do ENGINE_URL', () => {
    const url = urlDoAvisoDeEvento(ENGINE, ID);
    expect(url?.href).toBe(
      `http://engine:4000/internal/sessions/${ID}/event-appended`,
    );
  });

  it('preserva o prefixo de caminho do ENGINE_URL, com ou sem barra final', () => {
    expect(urlDoAvisoDeEvento('http://engine:4000/', ID)?.href).toBe(
      `http://engine:4000/internal/sessions/${ID}/event-appended`,
    );
    expect(urlDoAvisoDeEvento('http://engine:4000/e/', ID)?.href).toBe(
      `http://engine:4000/e/internal/sessions/${ID}/event-appended`,
    );
  });

  it.each([
    `${ID}/../../admin`,
    '../../admin',
    '..',
    `${ID}?x=1`,
    `${ID}#frag`,
    `x@evil.example`,
    '@evil.example',
    `${ID}%2F..%2Fadmin`,
    '%2F',
    `${ID}/`,
    'sess_1',
    '',
  ])('recusa %j (devolve null, nada sai da rota)', (sessionId) => {
    expect(urlDoAvisoDeEvento(ENGINE, sessionId)).toBeNull();
  });

  it('ENGINE_URL inválido não vira chamada', () => {
    expect(urlDoAvisoDeEvento('não é url', ID)).toBeNull();
  });
});

describe('HttpSessionChannelNotifier.eventAppended', () => {
  const ENGINE_URL_ORIGINAL = process.env.ENGINE_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ENGINE_URL_ORIGINAL === undefined) delete process.env.ENGINE_URL;
    else process.env.ENGINE_URL = ENGINE_URL_ORIGINAL;
  });

  it('id malicioso não chama fetch', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    process.env.ENGINE_URL = ENGINE;

    for (const id of ['../x', `${ID}?a`, `${ID}#a`, '@evil', '%2F', '/']) {
      new HttpSessionChannelNotifier().eventAppended(id, 'message.sent', 'u');
    }
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('id válido fora de transação chama fetch com a URL esperada', async () => {
    const fetchFalso = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchFalso);
    process.env.ENGINE_URL = ENGINE;

    new HttpSessionChannelNotifier().eventAppended(ID, 'message.sent', 'u');
    await vi.waitFor(() => expect(fetchFalso).toHaveBeenCalledTimes(1));

    const [url, init] = fetchFalso.mock.calls[0] as [URL, { body: string }];
    expect(String(url)).toBe(
      `http://engine:4000/internal/sessions/${ID}/event-appended`,
    );
    expect(JSON.parse(init.body)).toEqual({
      type: 'message.sent',
      actorId: 'u',
    });
  });
});
