import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestManualHandoffUseCase } from '../../../../src/application/use-cases/agents/request-manual-handoff.use-case';
import { CreateHandoffUseCase } from '../../../../src/application/use-cases/agents/create-handoff.use-case';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';

const PROJECT = 'proj-1';
const SESSION = 'sess-1';
const USER = 'user-1';

/**
 * ADR 0109/RN-440: handoff manual a agente à escolha. Reusa
 * `CreateHandoffUseCase` para a escrita — testado à parte em
 * `create-handoff.use-case.spec.ts` — e adiciona a camada de resolução de
 * `fromAgent` + o catálogo FECHADO de alvos endereçáveis (mais estrito que
 * `assertHandoffTargetAllowed`: aqui um agente inexistente também é
 * recusado, não só um subagente).
 */
function build(opts?: { activations?: SessionEvent[] }) {
  const criados: { fromAgent: string; toAgent: string }[] = [];
  const eventos: { type: string; actor: { kind: string; id: string } }[] = [];

  const handoffs = {
    create: (input: { fromAgent: string; toAgent: string }) => {
      criados.push(input);
      return Promise.resolve({ id: 'h-1', artifactId: null, ...input });
    },
  } as unknown as HandoffRepository;

  const appendEvent = {
    execute: (
      _p: string,
      _s: string,
      e: { type: string; actor: { kind: string; id: string } },
    ) => {
      eventos.push(e);
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  const createHandoff = new CreateHandoffUseCase(handoffs, appendEvent);

  const sessionEvents = {
    listByTypeInSession: (_sessionId: string, _type: string) =>
      Promise.resolve(opts?.activations ?? []),
  } as unknown as SessionEventRepository;

  return {
    useCase: new RequestManualHandoffUseCase(createHandoff, sessionEvents),
    criados,
    eventos,
  };
}

function activationEvent(agent: string, seq: number): SessionEvent {
  return {
    id: `evt-${seq}`,
    sessionId: SESSION,
    seq,
    type: 'agent.activated',
    actor: { kind: 'user', id: USER },
    payload: { agent },
    createdAt: new Date(),
  };
}

describe('RequestManualHandoffUseCase', () => {
  it('caminho feliz: endereça um LEAD de área, actor é o usuário', async () => {
    const { useCase, criados, eventos } = build({
      activations: [activationEvent('criativo', 1), activationEvent('po', 2)],
    });

    const result = await useCase.execute(PROJECT, SESSION, 'infra', USER);

    expect(result).toMatchObject({ toAgent: 'infra' });
    expect(criados).toEqual([
      expect.objectContaining({ fromAgent: 'po', toAgent: 'infra' }),
    ]);
    expect(eventos).toEqual([
      expect.objectContaining({
        type: 'handoff.offered',
        actor: { kind: 'user', id: USER },
      }),
    ]);
  });

  it('caminho feliz: endereça o Staff, agente solo (ADR 0088)', async () => {
    const { useCase, criados } = build({
      activations: [activationEvent('arquiteto', 1)],
    });

    await useCase.execute(PROJECT, SESSION, 'staff', USER);

    expect(criados).toEqual([
      expect.objectContaining({ fromAgent: 'arquiteto', toAgent: 'staff' }),
    ]);
  });

  it('sem nenhum agente ativado ainda, fromAgent cai no sentinela "usuario"', async () => {
    const { useCase, criados } = build({ activations: [] });

    await useCase.execute(PROJECT, SESSION, 'po', USER);

    expect(criados).toEqual([
      expect.objectContaining({ fromAgent: 'usuario', toAgent: 'po' }),
    ]);
  });

  it('recusa SUBAGENTE de área — não é um alvo endereçável manualmente', async () => {
    const { useCase, criados, eventos } = build();

    await expect(
      useCase.execute(PROJECT, SESSION, 'qa-automacao', USER),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(criados).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('recusa agente desconhecido — não é apenas "não subagente", tem de estar no catálogo', async () => {
    const { useCase, criados } = build();

    await expect(
      useCase.execute(PROJECT, SESSION, 'agente-que-nao-existe', USER),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(criados).toEqual([]);
  });
});
