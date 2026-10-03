import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ConflictException } from '@nestjs/common';
import { GateResumeController } from '../../../../src/interfaces/http/gates/gate-resume.controller';
import { ResumeParkedGateUseCase } from '../../../../src/application/use-cases/gates/resume-parked-gate.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import { GateNaoEstacionadoError } from '../../../../src/domain/gates/gate-nao-estacionado.error';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../../src/domain/iam/role';

/**
 * RN-724 (ADR 0207): o gesto humano que retoma o ciclo de gate estacionado.
 */
class FakeEngine {
  chamadas: string[][] = [];
  erro: Error | null = null;
  resumeParkedGate(projectId: string, taskId: string, gate: string) {
    this.chamadas.push([projectId, taskId, gate]);
    return this.erro ? Promise.reject(this.erro) : Promise.resolve();
  }
}

function montar() {
  const engine = new FakeEngine();
  const controller = new GateResumeController(
    new ResumeParkedGateUseCase(engine as unknown as ApiToEngineClient),
  );
  return { engine, controller };
}

describe('POST projects/:projectId/tasks/:taskId/gates/:gate/resume (RN-724)', () => {
  it('ciclo estacionado: pede ao engine e devolve ok', async () => {
    const { engine, controller } = montar();

    await expect(controller.resume('p1', 't1', 'qa')).resolves.toEqual({
      ok: true,
    });
    expect(engine.chamadas).toEqual([['p1', 't1', 'qa']]);
  });

  it('ciclo NÃO estacionado: 409 nomeado gate_nao_estacionado', async () => {
    const { engine, controller } = montar();
    engine.erro = new GateNaoEstacionadoError();

    const erro: unknown = await controller
      .resume('p1', 't1', 'qa')
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect((erro as ConflictException).getResponse()).toMatchObject({
      reason: 'gate_nao_estacionado',
    });
  });

  it('papel abaixo de developer é recusado (403 pelo RolesGuard): o mínimo de quem decide a PR', () => {
    const exigido = new Reflector().get<Role>(
      REQUIRED_ROLE_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- só lê metadado
      GateResumeController.prototype.resume,
    );

    expect(exigido).toBe('developer');
    expect(roleAtLeast('viewer', exigido)).toBe(false);
    expect(roleAtLeast('developer', exigido)).toBe(true);
  });
});
