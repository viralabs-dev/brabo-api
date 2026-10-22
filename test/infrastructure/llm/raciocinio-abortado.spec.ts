import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAICompatibleProvider } from '../../../src/infrastructure/llm/openai-compatible-provider';
import { campoDeRaciocinioDesligadoOpenRouter } from '../../../src/infrastructure/llm/openrouter-provider';
import { openaiConfig } from '../../../src/infrastructure/llm/openai-provider';

// RN-915 (ADR 0224): o raciocínio é contado no stream e a conexão é abortada.
let servidor: Server | undefined;
afterEach(() => {
  servidor?.closeAllConnections();
  servidor?.close();
});

const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

async function subir(comUsage: boolean) {
  let fechouPeloCliente = false;
  servidor = createServer((req, res) => {
    req.on('close', () => {
      fechouPeloCliente = true;
    });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // 4 x 400 caracteres = 400 tokens estimados de raciocínio.
    for (let i = 0; i < 4; i++) {
      res.write(
        frame({
          id: 'gen-1',
          choices: [{ delta: { reasoning: 'r'.repeat(400) } }],
        }),
      );
    }
    if (comUsage) {
      res.end(
        frame({
          id: 'gen-1',
          choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 7 },
        }) + 'data: [DONE]\n\n',
      );
    } // senão deixa aberto: só o aborto do cliente encerra
  });
  await new Promise<void>((r) => servidor!.listen(0, r));
  const base = openaiConfig(
    `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
  );
  const provider = new OpenAICompatibleProvider({
    ...base,
    campoDeRaciocinioDesligado: campoDeRaciocinioDesligadoOpenRouter,
  });
  return { provider, fechou: () => fechouPeloCliente };
}

async function coletar(
  p: OpenAICompatibleProvider,
  budget: number | undefined,
) {
  const chunks = [];
  for await (const c of p.chat([{ role: 'user', content: 'abcd'.repeat(10) }], {
    model: 'm',
    reasoning: true,
    ...(budget ? { reasoningBudget: budget } : {}),
  })) {
    chunks.push(c);
  }
  return chunks;
}

describe('raciocínio contado no stream e abortado no limite (RN-915)', () => {
  it('passa do orçamento: aborta, truncated com motivo, usage estimado', async () => {
    const { provider, fechou } = await subir(false);
    const chunks = await coletar(provider, 200);
    expect(chunks.find((c) => c.type === 'truncated')).toEqual({
      type: 'truncated',
      motivo: 'raciocinio',
    });
    const usage = chunks.find((c) => c.type === 'usage');
    expect(usage).toMatchObject({
      estimated: true,
      abortadoPeloRaciocinio: true,
      generationId: 'gen-1',
    });
    // aborta no 1º frame que passa de 200 tokens (3 x 400 caracteres = 300)
    expect((usage as { outputTokens: number }).outputTokens).toBe(300);
    await new Promise((r) => setTimeout(r, 50));
    expect(fechou()).toBe(true);
  });

  it('modelo SEM orçamento: não conta, não aborta, usage normal', async () => {
    const { provider } = await subir(true);
    const chunks = await coletar(provider, undefined);
    expect(chunks.some((c) => c.type === 'truncated')).toBe(false);
    expect(chunks.find((c) => c.type === 'usage')).toMatchObject({
      estimated: false,
      outputTokens: 7,
    });
    expect(chunks.some((c) => 'abortadoPeloRaciocinio' in c)).toBe(false);
  });

  it('dentro do orçamento: resposta com usage normal, sem estimativa', async () => {
    const { provider } = await subir(true);
    const chunks = await coletar(provider, 5000);
    expect(chunks.some((c) => c.type === 'truncated')).toBe(false);
    expect(chunks.find((c) => c.type === 'usage')).toMatchObject({
      estimated: false,
    });
  });
});
