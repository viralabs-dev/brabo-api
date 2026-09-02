import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  RagTelemetryRepository,
  type NewRagFeedback,
  type NewRagSearch,
  type RagFeedbackRecord,
  type RagSearchRecord,
} from '../../../../src/application/ports/rag-telemetry-repository.port';
import { RecordRagFeedbackUseCase } from '../../../../src/application/use-cases/rag/record-rag-feedback.use-case';
import { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

function mkBusca(overrides: Partial<RagSearchRecord> = {}): RagSearchRecord {
  return {
    id: 'search-1',
    projectId: 'proj-1',
    sessionId: null,
    actorKind: 'user',
    actorId: 'u-1',
    query: 'como funciona o gate de PR',
    topK: 10,
    hits: [
      {
        chunkId: 'chunk-a',
        score: 0.7,
        vectorScore: 0.8,
        lexicalScore: 0.3,
        rank: 1,
      },
      {
        chunkId: 'chunk-b',
        score: 0.4,
        vectorScore: 0.5,
        lexicalScore: null,
        rank: 2,
      },
    ],
    degraded: false,
    vectorAvailable: true,
    pesos: { vector: 0.6, lexical: 0.4, threshold: 0.2 },
    latencyMs: 42,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

class FakeRagTelemetryRepository extends RagTelemetryRepository {
  busca: RagSearchRecord | null = mkBusca();
  votos: NewRagFeedback[] = [];

  async recordSearch(_input: NewRagSearch): Promise<RagSearchRecord> {
    throw new Error('não usado neste teste');
  }
  async findSearchById(id: string): Promise<RagSearchRecord | null> {
    return this.busca && this.busca.id === id ? this.busca : null;
  }
  async recordFeedback(input: NewRagFeedback): Promise<RagFeedbackRecord> {
    this.votos.push(input);
    return { ...input, id: `fb-${this.votos.length}`, createdAt: new Date() };
  }
}

function fakeEventos() {
  const narrados: {
    sessionId: string;
    type: string;
    payload: Record<string, unknown>;
  }[] = [];
  const uc = {
    execute: async (
      _projectId: string,
      sessionId: string,
      input: { type: string; payload: Record<string, unknown> },
    ) => {
      narrados.push({ sessionId, type: input.type, payload: input.payload });
      return undefined;
    },
  } as unknown as AppendSessionEventUseCase;
  return { uc, narrados };
}

describe('RecordRagFeedbackUseCase (RN-480)', () => {
  it('caminho feliz: grava o voto e devolve o RANK que o trecho tinha naquela busca', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    const eventos = fakeEventos();
    const useCase = new RecordRagFeedbackUseCase(telemetry, eventos.uc);

    const relatorio = await useCase.execute({
      projectId: 'proj-1',
      searchId: 'search-1',
      chunkId: 'chunk-b',
      verdict: 'util',
      actor: { kind: 'user', id: 'u-1' },
    });

    // O rank é a informação que separa "índice pobre" de "pesos errados":
    // votar útil no rank 2 diz algo que votar útil no rank 1 não diz.
    expect(relatorio).toEqual({
      searchId: 'search-1',
      chunkId: 'chunk-b',
      verdict: 'util',
      rank: 2,
    });
    expect(telemetry.votos).toEqual([
      {
        searchId: 'search-1',
        chunkId: 'chunk-b',
        verdict: 'util',
        actorKind: 'user',
        actorId: 'u-1',
      },
    ]);
  });

  it('RN-481: narra `rag.feedback` quando a busca votada TINHA sessão', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    telemetry.busca = mkBusca({ sessionId: 'sess-1' });
    const eventos = fakeEventos();
    const useCase = new RecordRagFeedbackUseCase(telemetry, eventos.uc);

    await useCase.execute({
      projectId: 'proj-1',
      searchId: 'search-1',
      chunkId: 'chunk-a',
      verdict: 'irrelevante',
      actor: { kind: 'agent', id: 'qa' },
    });

    expect(eventos.narrados).toEqual([
      {
        sessionId: 'sess-1',
        type: 'rag.feedback',
        payload: {
          searchId: 'search-1',
          chunkId: 'chunk-a',
          verdict: 'irrelevante',
          rank: 1,
        },
      },
    ]);
  });

  it('busca SEM sessão (veio da aba) grava o voto e não narra evento nenhum', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    const eventos = fakeEventos();
    const useCase = new RecordRagFeedbackUseCase(telemetry, eventos.uc);

    await useCase.execute({
      projectId: 'proj-1',
      searchId: 'search-1',
      chunkId: 'chunk-a',
      verdict: 'util',
      actor: { kind: 'user', id: 'u-1' },
    });

    expect(telemetry.votos).toHaveLength(1);
    expect(eventos.narrados).toHaveLength(0);
  });

  it('CASO DE FALHA: `searchId` desconhecido é 400 que ENSINA, nunca voto gravado', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    const useCase = new RecordRagFeedbackUseCase(telemetry, fakeEventos().uc);

    await expect(
      useCase.execute({
        projectId: 'proj-1',
        searchId: 'search-inventado',
        chunkId: 'chunk-a',
        verdict: 'util',
        actor: { kind: 'user', id: 'u-1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(telemetry.votos).toHaveLength(0);
  });

  it('CASO DE FALHA: chunk que NÃO estava entre os hits é 400 — voto sem rank não mede nada', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    const useCase = new RecordRagFeedbackUseCase(telemetry, fakeEventos().uc);

    await expect(
      useCase.execute({
        projectId: 'proj-1',
        searchId: 'search-1',
        chunkId: 'chunk-que-nao-veio',
        verdict: 'util',
        actor: { kind: 'user', id: 'u-1' },
      }),
    ).rejects.toThrow(/não estava entre os 2 resultado/);
    expect(telemetry.votos).toHaveLength(0);
  });

  it('CASO DE FALHA: busca de OUTRO projeto é 400 — o papel do chamador é naquele projeto', async () => {
    const telemetry = new FakeRagTelemetryRepository();
    const useCase = new RecordRagFeedbackUseCase(telemetry, fakeEventos().uc);

    await expect(
      useCase.execute({
        projectId: 'proj-2',
        searchId: 'search-1',
        chunkId: 'chunk-a',
        verdict: 'util',
        actor: { kind: 'user', id: 'u-1' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(telemetry.votos).toHaveLength(0);
  });
});
