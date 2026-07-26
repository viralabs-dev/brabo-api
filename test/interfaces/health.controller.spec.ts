import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../../src/interfaces/http/health/health.controller';
import { DRIZZLE } from '../../src/infrastructure/persistence/drizzle/drizzle-client';

/**
 * A separação entre liveness e readiness da Fase 5.
 *
 * O ponto do primeiro teste não é "responde ok" — é que ele responde ok com o
 * banco INDISPONÍVEL. Se um dia alguém unificar as duas probes, um Postgres
 * lento passa a reiniciar todas as réplicas da api ao mesmo tempo: degradação
 * vira queda total, e o kubelet faz isso por conta própria, sem alerta que
 * explique a causa.
 */
describe('HealthController', () => {
  let controller: HealthController;
  const execute = vi.fn();

  beforeEach(async () => {
    execute.mockReset();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DRIZZLE, useValue: { execute } }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  describe('GET /live (liveness)', () => {
    it('responde ok mesmo com o banco fora', () => {
      execute.mockRejectedValue(new Error('connection refused'));

      expect(controller.live()).toMatchObject({
        service: 'api',
        status: 'ok',
      });
    });

    it('não consulta o banco', () => {
      controller.live();

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('GET /health (readiness)', () => {
    it('responde ok quando o banco responde', async () => {
      execute.mockResolvedValue(undefined);

      await expect(controller.check()).resolves.toMatchObject({
        service: 'api',
        status: 'ok',
      });
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it('responde 503 quando o banco está fora — é o que tira o pod do balanceamento', async () => {
      execute.mockRejectedValue(new Error('connection refused'));

      await expect(controller.check()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
