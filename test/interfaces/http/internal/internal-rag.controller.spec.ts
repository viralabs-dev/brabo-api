import { describe, expect, it } from 'vitest';
import { InternalRagController } from '../../../../src/interfaces/http/internal/internal-rag.controller';
import type { HybridSearchUseCase } from '../../../../src/application/use-cases/rag/hybrid-search.use-case';

/**
 * `InternalRagController` REUSA `HybridSearchUseCase` — nenhuma lógica de
 * busca nova aqui, só a projeção para o contrato fechado
 * `{ path, chunk, score, excerpt }` / `{ degraded }`. É essa projeção que
 * este teste cobre.
 */
describe('InternalRagController', () => {
  it('caminho feliz: projeta hits de escopo "docs" (origin file) com path=sourcePath', async () => {
    const search = {
      execute: () =>
        Promise.resolve({
          query: 'x',
          hits: [
            {
              chunkId: 'c1',
              scope: 'docs' as const,
              content: 'a'.repeat(10),
              score: 0.9,
              vectorScore: 0.9,
              lexicalScore: null,
              origin: {
                kind: 'file' as const,
                sourcePath: 'docs/adr/0080-x.md',
              },
            },
          ],
          vectorAvailable: true,
        }),
    } as unknown as HybridSearchUseCase;
    const controller = new InternalRagController(search);

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.degraded).toBe(false);
    expect(resposta.hits).toEqual([
      {
        path: 'docs/adr/0080-x.md',
        chunk: 'a'.repeat(10),
        score: 0.9,
        excerpt: 'a'.repeat(10),
      },
    ]);
  });

  it('hit de escopo "session" (origin session) vira path sintético "session:<id>"', async () => {
    const search = {
      execute: () =>
        Promise.resolve({
          query: 'x',
          hits: [
            {
              chunkId: 'c2',
              scope: 'session' as const,
              content: 'trecho da conversa',
              score: 0.5,
              vectorScore: null,
              lexicalScore: 0.5,
              origin: { kind: 'session' as const, sessionId: 'sess-1' },
            },
          ],
          vectorAvailable: true,
        }),
    } as unknown as HybridSearchUseCase;
    const controller = new InternalRagController(search);

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.hits[0].path).toBe('session:sess-1');
  });

  it('degraded reflete !vectorAvailable (RN-233) — busca caiu para léxico-only', async () => {
    const search = {
      execute: () =>
        Promise.resolve({
          query: 'x',
          hits: [],
          vectorAvailable: false,
          vectorUnavailableReason: 'provider fora do ar',
        }),
    } as unknown as HybridSearchUseCase;
    const controller = new InternalRagController(search);

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.degraded).toBe(true);
    expect(resposta.hits).toEqual([]);
  });

  it('chunk longo é truncado no excerpt, com reticências', async () => {
    const conteudoLongo = 'x'.repeat(500);
    const search = {
      execute: () =>
        Promise.resolve({
          query: 'x',
          hits: [
            {
              chunkId: 'c3',
              scope: 'docs' as const,
              content: conteudoLongo,
              score: 0.8,
              vectorScore: 0.8,
              lexicalScore: null,
              origin: { kind: 'file' as const, sourcePath: 'docs/x.md' },
            },
          ],
          vectorAvailable: true,
        }),
    } as unknown as HybridSearchUseCase;
    const controller = new InternalRagController(search);

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.hits[0].chunk).toBe(conteudoLongo); // o chunk INTEIRO não é truncado
    expect(resposta.hits[0].excerpt.length).toBeLessThan(conteudoLongo.length);
    expect(resposta.hits[0].excerpt.endsWith('…')).toBe(true);
  });
});
