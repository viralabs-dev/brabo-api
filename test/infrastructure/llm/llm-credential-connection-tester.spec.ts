import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LLMCredentialConnectionTesterImpl } from '../../../src/infrastructure/llm/llm-credential-connection-tester';
import { LLMCredentialConnectionTestFailedError } from '../../../src/domain/llm/llm-credential-errors';

/**
 * Servidor `GET /key` falso, na mesma linha do `fake-llm-server` (Fase 9a):
 * porta efêmera de verdade, não mock de `fetch` — o que está sob teste inclui
 * o transporte (`getJson`), não só a lógica de status.
 */
async function subirServidorDeChave(
  responder: (headers: Record<string, string | string[] | undefined>) => {
    status: number;
    body: string;
  },
): Promise<{ baseUrl: string; fechar: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const { status, body } = responder(req.headers);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    fechar: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('LLMCredentialConnectionTesterImpl', () => {
  it('provider sem teste declarado é NO-OP — nunca faz chamada de rede', async () => {
    const tester = new LLMCredentialConnectionTesterImpl({
      openrouter: 'http://127.0.0.1:1', // porta que nada escuta: se isso for chamado, estoura
    });

    await expect(
      tester.test('anthropic', 'qualquer-chave'),
    ).resolves.toBeUndefined();
    await expect(
      tester.test('openai', 'qualquer-chave'),
    ).resolves.toBeUndefined();
    await expect(
      tester.test('ollama', 'qualquer-chave'),
    ).resolves.toBeUndefined();
  });

  it('openrouter: GET /key com 200 resolve — Authorization Bearer vai no cabeçalho', async () => {
    let authRecebido: string | undefined;
    const servidor = await subirServidorDeChave((headers) => {
      authRecebido = headers.authorization as string | undefined;
      return { status: 200, body: JSON.stringify({ data: { limit: null } }) };
    });

    const tester = new LLMCredentialConnectionTesterImpl({
      openrouter: servidor.baseUrl,
    });
    await expect(
      tester.test('openrouter', 'sk-or-abc123'),
    ).resolves.toBeUndefined();
    await servidor.fechar();

    expect(authRecebido).toBe('Bearer sk-or-abc123');
  });

  it('openrouter: status não-2xx vira LLMCredentialConnectionTestFailedError, nunca deixa passar', async () => {
    const servidor = await subirServidorDeChave(() => ({
      status: 401,
      body: JSON.stringify({ error: { message: 'chave inválida' } }),
    }));

    const tester = new LLMCredentialConnectionTesterImpl({
      openrouter: servidor.baseUrl,
    });
    const erro = await tester
      .test('openrouter', 'chave-invalida')
      .catch((e: unknown) => e);
    await servidor.fechar();

    expect(erro).toBeInstanceOf(LLMCredentialConnectionTestFailedError);
    expect((erro as LLMCredentialConnectionTestFailedError).provider).toBe(
      'openrouter',
    );
  });

  it('openrouter: falha de conexão (servidor fora do ar) também vira LLMCredentialConnectionTestFailedError', async () => {
    const tester = new LLMCredentialConnectionTesterImpl({
      openrouter: 'http://127.0.0.1:1',
    });

    await expect(tester.test('openrouter', 'qualquer-chave')).rejects.toThrow(
      LLMCredentialConnectionTestFailedError,
    );
  });
});
