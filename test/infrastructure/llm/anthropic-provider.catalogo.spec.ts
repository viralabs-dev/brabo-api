import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../../src/infrastructure/llm/anthropic-provider';

let servidor: Server;
let baseURL: string;

beforeAll(async () => {
  const modelo = (id: string, thinking: boolean | null) => ({
    id,
    type: 'model',
    display_name: id,
    created_at: '2026-08-02T00:00:00Z',
    max_input_tokens: 200_000,
    max_tokens: 64_000,
    capabilities:
      thinking === null
        ? null
        : { thinking: { supported: thinking, types: {} } },
  });
  servidor = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        data: [
          modelo('claude-haiku-4-5-20251001', true),
          modelo('claude-opus-5', null),
          modelo('claude-desconhecido-9', false),
        ],
        first_id: 'a',
        last_id: 'b',
        has_more: false,
      }),
    );
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  baseURL = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => servidor.close());

describe('AnthropicProvider.listModels: preço de lista e raciocínio (RN-997)', () => {
  it('traz preço para ID conhecido (com e sem sufixo de data) e nenhum para o desconhecido', async () => {
    const lista = await new AnthropicProvider({
      baseURL,
      maxRetries: 0,
    }).listModels('k');
    const por = Object.fromEntries(lista.map((m) => [m.name, m]));
    expect(por['claude-haiku-4-5-20251001']).toMatchObject({
      inputPricePerMillionMicros: 1_000_000,
      outputPricePerMillionMicros: 5_000_000,
    });
    expect(por['claude-opus-5']).toMatchObject({
      inputPricePerMillionMicros: 5_000_000,
      outputPricePerMillionMicros: 25_000_000,
    });
    expect(
      por['claude-desconhecido-9'].inputPricePerMillionMicros,
    ).toBeUndefined();
  });

  it('supportsReasoning vem de capabilities.thinking, com a família como reserva', async () => {
    const lista = await new AnthropicProvider({
      baseURL,
      maxRetries: 0,
    }).listModels('k');
    const por = Object.fromEntries(
      lista.map((m) => [m.name, m.supportsReasoning]),
    );
    expect(por).toEqual({
      'claude-haiku-4-5-20251001': true,
      'claude-opus-5': true,
      'claude-desconhecido-9': false,
    });
  });
});
