import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProposeMaxParallelUseCase } from '../../../../src/application/use-cases/execution/propose-max-parallel.use-case';
import type { AgentAreaRepository } from '../../../../src/application/ports/agent-area-repository.port';
import type { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeAreas {
  maxParallel: number | null = 2;
  findByKey(_p: string, key: string) {
    return Promise.resolve(
      this.maxParallel == null
        ? null
        : {
            id: 'a1',
            projectId: PROJECT,
            key,
            leadAgentId: 'dev-lead',
            maxParallel: this.maxParallel,
            members: [],
          },
    );
  }
}

class FakePropose {
  chamadas: { actionType: string; actor: unknown; payload: unknown }[] = [];
  execute(_p: string, _s: string, input: never) {
    this.chamadas.push(
      input as unknown as {
        actionType: string;
        actor: unknown;
        payload: unknown;
      },
    );
    return Promise.resolve({ id: 'act-9' } as never);
  }
}

let areas: FakeAreas;
let propose: FakePropose;
let uc: ProposeMaxParallelUseCase;

beforeEach(() => {
  areas = new FakeAreas();
  propose = new FakePropose();
  uc = new ProposeMaxParallelUseCase(
    areas as unknown as AgentAreaRepository,
    propose as unknown as ProposeActionUseCase,
  );
});

const entrada = { area: 'dev', proposto: 4, rationale: 'quatro aprovações' };

describe('ProposeMaxParallelUseCase', () => {
  it('cria a proposta com o teto atual e o proposto no payload', async () => {
    // Os dois números vão no payload IMUTÁVEL: quem decide precisa ver de
    // ONDE para ONDE, não só o destino.
    await uc.execute(PROJECT, SESSION, entrada);

    expect(propose.chamadas[0]!.actionType).toBe('raise_max_parallel');
    expect(propose.chamadas[0]!.payload).toMatchObject({
      area: 'dev',
      atual: 2,
      proposto: 4,
    });
  });

  it('quem propõe é a ANAMNESE, não o usuário', async () => {
    await uc.execute(PROJECT, SESSION, entrada);

    expect(propose.chamadas[0]!.actor).toEqual({
      kind: 'agent',
      id: 'anamnese',
    });
  });

  it('propor o teto que JÁ vigora é recusado', async () => {
    // A Anamnese roda periodicamente. Sem esta recusa ela reproporia a mesma
    // coisa a cada rodada, enchendo de ruído uma fila que o usuário lê.
    areas.maxParallel = 4;

    await expect(uc.execute(PROJECT, SESSION, entrada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(propose.chamadas).toHaveLength(0);
  });

  it('propor um teto MENOR é recusado', async () => {
    areas.maxParallel = 8;

    await expect(uc.execute(PROJECT, SESSION, entrada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(propose.chamadas).toHaveLength(0);
  });

  it('área inexistente é recusada, sem criar ação órfã', async () => {
    areas.maxParallel = null;

    await expect(uc.execute(PROJECT, SESSION, entrada)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(propose.chamadas).toHaveLength(0);
  });

  it('teto proposto inválido é recusado antes de tocar o banco', async () => {
    await expect(
      uc.execute(PROJECT, SESSION, { ...entrada, proposto: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      uc.execute(PROJECT, SESSION, { ...entrada, proposto: 2.5 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(propose.chamadas).toHaveLength(0);
  });
});
