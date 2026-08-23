import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SetAreaBudgetUseCase } from '../../../../src/application/use-cases/execution/set-area-budget.use-case';
import type { AgentAreaRepository } from '../../../../src/application/ports/agent-area-repository.port';

const PROJECT = 'p1';

class FakeAreas {
  chamadas: { key: string; budgetMicros: number | null }[] = [];

  setBudget(_projectId: string, key: string, budgetMicros: number | null) {
    this.chamadas.push({ key, budgetMicros });
    return Promise.resolve({
      id: 'a1',
      projectId: PROJECT,
      key,
      leadAgentId: 'dev-lead',
      maxParallel: 2,
      budgetMicros,
      spentMicros: 0,
      members: [],
    });
  }
}

let areas: FakeAreas;
let uc: SetAreaBudgetUseCase;

beforeEach(() => {
  areas = new FakeAreas();
  uc = new SetAreaBudgetUseCase(areas as unknown as AgentAreaRepository);
});

describe('SetAreaBudgetUseCase', () => {
  it('grava o teto novo, em micro-USD já convertido', async () => {
    const area = await uc.execute(PROJECT, 'dev', 20_000_000);

    expect(area.budgetMicros).toBe(20_000_000);
    expect(areas.chamadas).toEqual([{ key: 'dev', budgetMicros: 20_000_000 }]);
  });

  it('null limpa o teto (volta a ilimitado)', async () => {
    const area = await uc.execute(PROJECT, 'dev', null);

    expect(area.budgetMicros).toBeNull();
    expect(areas.chamadas).toEqual([{ key: 'dev', budgetMicros: null }]);
  });

  it('zero é válido — é um teto de verdade, "bloqueia tudo", não erro', async () => {
    const area = await uc.execute(PROJECT, 'dev', 0);

    expect(area.budgetMicros).toBe(0);
  });

  it('recusa negativo SEM gravar', async () => {
    await expect(uc.execute(PROJECT, 'dev', -1)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(areas.chamadas).toHaveLength(0);
  });

  it('recusa NaN/Infinity SEM gravar', async () => {
    await expect(
      uc.execute(PROJECT, 'dev', Number.POSITIVE_INFINITY),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(uc.execute(PROJECT, 'dev', NaN)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(areas.chamadas).toHaveLength(0);
  });

  it('arredonda fracionário pro inteiro mais próximo', async () => {
    const area = await uc.execute(PROJECT, 'dev', 100.6);

    expect(area.budgetMicros).toBe(101);
  });
});
