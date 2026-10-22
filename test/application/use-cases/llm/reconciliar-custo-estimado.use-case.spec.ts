import { beforeEach, describe, expect, it, vi } from 'vitest';

const getJson = vi.hoisted(() => vi.fn());
vi.mock('../../../../src/infrastructure/llm/http-stream', () => ({ getJson }));

import { ReconciliarCustoEstimadoUseCase } from '../../../../src/application/use-cases/llm/reconciliar-custo-estimado.use-case';

// RN-915 (ADR 0224): a estimativa só é trocada com 200 do /generation.
describe('ReconciliarCustoEstimadoUseCase', () => {
  const linha = {
    id: 'u1',
    projectId: 'p1',
    provider: 'openrouter' as const,
    generationId: 'gen-1',
    costMicros: 900,
    inputTokens: 100,
    outputTokens: 400,
  };
  const usage = {
    listarACorrigir: vi.fn(),
    aplicarCustoReal: vi.fn(),
  };
  const caso = () =>
    new ReconciliarCustoEstimadoUseCase(
      usage as never,
      { findSecretByUserAndProvider: () => Promise.resolve('segredo') } as never,
      { decrypt: () => 'sk-x' } as never,
      { execute: () => Promise.resolve('dono') } as never,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    usage.listarACorrigir.mockResolvedValue([linha]);
    usage.aplicarCustoReal.mockResolvedValue(true);
  });

  it('200: troca pelo custo real com preço implícito', async () => {
    getJson.mockResolvedValue({
      status: 200,
      body: JSON.stringify({ data: { total_cost: 0.000321 } }),
    });
    expect(await caso().execute()).toBe(1);
    // 321 micros / 500 tokens * 1e6
    expect(usage.aplicarCustoReal).toHaveBeenCalledWith('u1', 321, 642000);
  });

  it('404: a linha fica como está para a próxima passada', async () => {
    getJson.mockResolvedValue({ status: 404, body: '{}' });
    expect(await caso().execute()).toBe(0);
    expect(usage.aplicarCustoReal).not.toHaveBeenCalled();
  });

  it('erro de rede ou corpo sem custo: não derruba nem troca', async () => {
    getJson.mockRejectedValueOnce(new Error('rede'));
    expect(await caso().execute()).toBe(0);
    getJson.mockResolvedValueOnce({ status: 200, body: '{"data":{}}' });
    expect(await caso().execute()).toBe(0);
    expect(usage.aplicarCustoReal).not.toHaveBeenCalled();
  });
});
