import { describe, expect, it, vi } from 'vitest';
import { InternalRagController } from '../../../../src/interfaces/http/internal/internal-rag.controller';
import type { HybridSearchUseCase } from '../../../../src/application/use-cases/rag/hybrid-search.use-case';
import type { RecordRagFeedbackUseCase } from '../../../../src/application/use-cases/rag/record-rag-feedback.use-case';

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
          searchId: 'b-1',
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
    const controller = new InternalRagController(
      search,
      {} as RecordRagFeedbackUseCase,
    );

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.degraded).toBe(false);
    expect(resposta.searchId).toBe('b-1');
    expect(resposta.hits).toEqual([
      {
        chunkId: 'c1',
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
          searchId: 'b-1',
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
    const controller = new InternalRagController(
      search,
      {} as RecordRagFeedbackUseCase,
    );

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
          searchId: 'b-1',
          hits: [],
          vectorAvailable: false,
          vectorUnavailableReason: 'provider fora do ar',
        }),
    } as unknown as HybridSearchUseCase;
    const controller = new InternalRagController(
      search,
      {} as RecordRagFeedbackUseCase,
    );

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
          searchId: 'b-1',
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
    const controller = new InternalRagController(
      search,
      {} as RecordRagFeedbackUseCase,
    );

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(resposta.hits[0].chunk).toBe(conteudoLongo); // o chunk INTEIRO não é truncado
    expect(resposta.hits[0].excerpt.length).toBeLessThan(conteudoLongo.length);
    expect(resposta.hits[0].excerpt.endsWith('…')).toBe(true);
  });
  // ------------------------------------------------------------- RN-480

  it('votar: repassa o agente do corpo como ATOR e reusa o MESMO caso de uso da rota humana', async () => {
    // Não há segundo caminho de julgamento: a recusa por id desconhecido é a
    // mesma dos dois lados, e o engine é quem a transforma em tool-result.
    const execute = vi.fn().mockResolvedValue({
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'irrelevante',
      rank: 5,
    });
    const controller = new InternalRagController(
      {} as HybridSearchUseCase,
      { execute } as unknown as RecordRagFeedbackUseCase,
    );

    const resposta = await controller.votar({
      projectId: 'proj-1',
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'irrelevante',
      agent: 'qa',
    });

    expect(execute).toHaveBeenCalledWith({
      projectId: 'proj-1',
      searchId: 'b-1',
      chunkId: 'c-9',
      verdict: 'irrelevante',
      actor: { kind: 'agent', id: 'qa' },
    });
    // O `rank` volta porque é a informação que o MODELO não tinha.
    expect(resposta.rank).toBe(5);
  });

  it('sessionId/agent do corpo chegam ao caso de uso — a api não os deduz (RN-479/481)', async () => {
    const execute = vi.fn().mockResolvedValue({
      query: 'x',
      searchId: 'b-1',
      hits: [],
      vectorAvailable: true,
    });
    const controller = new InternalRagController(
      { execute } as unknown as HybridSearchUseCase,
      {} as RecordRagFeedbackUseCase,
    );

    await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
      sessionId: 'sess-1',
      agent: 'dev-lead',
    });

    expect(execute).toHaveBeenCalledWith({
      projectId: 'proj-1',
      query: 'x',
      limit: undefined,
      sessionId: 'sess-1',
      actor: { kind: 'agent', id: 'dev-lead' },
    });
  });

  it('sem sessionId/agent no corpo, o caso de uso recebe null/undefined — nunca um ator inventado', async () => {
    const execute = vi.fn().mockResolvedValue({
      query: 'x',
      searchId: null,
      hits: [],
      vectorAvailable: true,
    });
    const controller = new InternalRagController(
      { execute } as unknown as HybridSearchUseCase,
      {} as RecordRagFeedbackUseCase,
    );

    const resposta = await controller.buscar({
      projectId: 'proj-1',
      query: 'x',
    });

    expect(execute).toHaveBeenCalledWith({
      projectId: 'proj-1',
      query: 'x',
      limit: undefined,
      sessionId: null,
      actor: undefined,
    });
    // Telemetria não gravada: `searchId: null` chega ao engine, e a tool omite
    // os ids em vez de oferecer ao modelo uma referência que seria recusada.
    expect(resposta.searchId).toBeNull();
  });
});
