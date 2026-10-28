import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AgentResumeController } from '../../../../src/interfaces/http/sessions/agent-resume.controller';
import { ResumeAgentTurnUseCase } from '../../../../src/application/use-cases/sessions/resume-agent-turn.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import { TurnoNaoRetomavelError } from '../../../../src/domain/sessions/turno-nao-retomavel.error';
import { REQUIRED_ROLE_KEY } from '../../../../src/interfaces/http/iam/require-role.decorator';
import { roleAtLeast, type Role } from '../../../../src/domain/iam/role';

/** AT-582 (ADR 0226): o botão "Retomar" do turno interrompido. */
function montar(opts: { sessao?: boolean; erro?: Error } = {}) {
  const chamadas: string[][] = [];
  const engine = {
    resumeAgentTurn: (p: string, s: string, a: string) => {
      chamadas.push([p, s, a]);
      return opts.erro ? Promise.reject(opts.erro) : Promise.resolve();
    },
  };
  const sessions = {
    findInProject: () => Promise.resolve(opts.sessao === false ? null : {}),
  };
  const controller = new AgentResumeController(
    new ResumeAgentTurnUseCase(
      sessions as unknown as SessionRepository,
      engine as unknown as ApiToEngineClient,
    ),
  );
  return { chamadas, controller };
}

describe('POST projects/:projectId/sessions/:sessionId/agents/:agent/resume', () => {
  it('turno interrompido: pede ao engine e devolve ok', async () => {
    const { chamadas, controller } = montar();
    await expect(controller.resume('p1', 's1', 'po')).resolves.toEqual({
      ok: true,
    });
    expect(chamadas).toEqual([['p1', 's1', 'po']]);
  });

  it.each(['turno_nao_interrompido', 'agente_sem_retomada'])(
    'engine recusa com %s: 409 nomeado',
    async (reason) => {
      const { controller } = montar({
        erro: new TurnoNaoRetomavelError(reason),
      });
      const erro: unknown = await controller
        .resume('p1', 's1', 'po')
        .catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ConflictException);
      expect((erro as ConflictException).getResponse()).toMatchObject({
        reason,
      });
    },
  );

  it('sessão que não é do projeto: 404, sem falar com o engine', async () => {
    const { chamadas, controller } = montar({ sessao: false });
    await expect(controller.resume('p1', 's1', 'po')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(chamadas).toEqual([]);
  });

  it('papel abaixo de developer é recusado (RolesGuard)', () => {
    const exigido = new Reflector().get<Role>(
      REQUIRED_ROLE_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method -- só lê metadado
      AgentResumeController.prototype.resume,
    );
    expect(exigido).toBe('developer');
    expect(roleAtLeast('viewer', exigido)).toBe(false);
  });
});
