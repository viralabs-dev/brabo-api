import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateHandoffUseCase } from '../../../../src/application/use-cases/agents/create-handoff.use-case';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';

function build() {
  const criados: { toAgent: string }[] = [];
  const eventos: { type: string }[] = [];

  const handoffs = {
    create: (input: { toAgent: string }) => {
      criados.push(input);
      return Promise.resolve({ id: 'h-1', artifactId: null, ...input });
    },
  } as unknown as HandoffRepository;

  const appendEvent = {
    execute: (_p: string, _s: string, e: { type: string }) => {
      eventos.push(e);
      return Promise.resolve({});
    },
  } as unknown as AppendSessionEventUseCase;

  return {
    useCase: new CreateHandoffUseCase(handoffs, appendEvent),
    criados,
    eventos,
  };
}

/**
 * O ADR 0038 mandou `CreateHandoffUseCase` validar o alvo — é o único lugar do
 * sistema que grava `toAgent` — e a validação nunca foi implementada (achado
 * #12 do primeiro dogfooding). A `offer_handoff` do engine repassa `to_agent`
 * como string livre, então até aqui nada impedia um agente de se dirigir
 * direto a um subagente e furar a hierarquia.
 */
describe('CreateHandoffUseCase — alvo do handoff', () => {
  it('handoff para agente sem área passa (Criativo → PO)', async () => {
    const { useCase, criados, eventos } = build();

    await useCase.execute('proj-1', 'sess-1', {
      fromAgent: 'criativo',
      toAgent: 'po',
    });

    expect(criados).toEqual([
      expect.objectContaining({ toAgent: 'po', status: 'offered' }),
    ]);
    expect(eventos.map((e) => e.type)).toEqual(['handoff.offered']);
  });

  it('handoff para LEAD de área passa', async () => {
    const { useCase, criados } = build();

    await useCase.execute('proj-1', 'sess-1', {
      fromAgent: 'arquiteto',
      toAgent: 'qa',
    });

    expect(criados).toHaveLength(1);
  });

  it('handoff para SUBAGENTE é recusado, sem linha e sem evento', async () => {
    const { useCase, criados, eventos } = build();

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        fromAgent: 'arquiteto',
        toAgent: 'qa-automacao',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // O ponto: recusar DEPOIS do insert deixaria um handoff fantasma e um
    // evento imutável afirmando uma oferta que a política não permite.
    expect(criados).toEqual([]);
    expect(eventos).toEqual([]);
  });

  it('a recusa nomeia o lead a quem o chamador devia falar', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute('proj-1', 'sess-1', {
        fromAgent: 'po',
        toAgent: 'infra-workflows',
      }),
    ).rejects.toThrow(/lead "infra"/);
  });
});
