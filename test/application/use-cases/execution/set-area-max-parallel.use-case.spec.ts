import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SetAreaMaxParallelUseCase } from '../../../../src/application/use-cases/execution/set-area-max-parallel.use-case';
import type { AgentAreaRepository } from '../../../../src/application/ports/agent-area-repository.port';

const PROJECT = 'p1';

class FakeAreas {
  chamadas: { key: string; maxParallel: number }[] = [];

  setMaxParallel(_projectId: string, key: string, maxParallel: number) {
    this.chamadas.push({ key, maxParallel });
    return Promise.resolve({
      id: 'a1',
      projectId: PROJECT,
      key,
      leadAgentId: 'dev-lead',
      maxParallel,
      members: [],
    });
  }
}

let areas: FakeAreas;
let uc: SetAreaMaxParallelUseCase;

beforeEach(() => {
  areas = new FakeAreas();
  uc = new SetAreaMaxParallelUseCase(areas as unknown as AgentAreaRepository);
});

describe('SetAreaMaxParallelUseCase', () => {
  it('grava o teto novo', async () => {
    const area = await uc.execute(PROJECT, 'dev', 5);

    expect(area.maxParallel).toBe(5);
    expect(areas.chamadas).toEqual([{ key: 'dev', maxParallel: 5 }]);
  });

  it('recusa zero SEM gravar', async () => {
    // Zero não é "sem limite": é configuração inválida. E a recusa precisa
    // acontecer aqui, perto da tela onde o usuário errou o número — não lá na
    // frente, no agente que misteriosamente não sobe.
    await expect(uc.execute(PROJECT, 'dev', 0)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(areas.chamadas).toHaveLength(0);
  });

  it('recusa negativo SEM gravar', async () => {
    await expect(uc.execute(PROJECT, 'dev', -3)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(areas.chamadas).toHaveLength(0);
  });

  it('recusa fracionário SEM gravar', async () => {
    // Meio agente não existe, e `2.5` truncado silenciosamente para `2` seria
    // o produto decidindo por cima do usuário.
    await expect(uc.execute(PROJECT, 'dev', 2.5)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(areas.chamadas).toHaveLength(0);
  });

  it('1 é válido — é o mínimo, não um caso de borda proibido', async () => {
    const area = await uc.execute(PROJECT, 'dev', 1);

    expect(area.maxParallel).toBe(1);
  });
});
