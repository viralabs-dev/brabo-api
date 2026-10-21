import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CreateEpicUseCase } from '../../../../src/application/use-cases/backlog/create-epic.use-case';
import type { EpicRepository } from '../../../../src/application/ports/backlog-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { Epic } from '../../../../src/domain/backlog/backlog.entity';

function epic(over: Partial<Epic> = {}): Epic {
  return {
    id: 'epic-1',
    projectId: 'p1',
    sessionId: 's1',
    title: 'Cadastro',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

function montar(existentes: Epic[]) {
  const criados: Partial<Epic>[] = [];
  const eventos: unknown[] = [];
  const epics = {
    findByProject: () => Promise.resolve(existentes),
    create: (input: Partial<Epic>) => {
      criados.push(input);
      return Promise.resolve(epic({ ...input, id: 'epic-novo' }));
    },
  } as unknown as EpicRepository;
  const append = {
    execute: (_p: string, _s: string, e: unknown) => {
      eventos.push(e);
      return Promise.resolve();
    },
  } as unknown as AppendSessionEventUseCase;
  return { uc: new CreateEpicUseCase(epics, append), criados, eventos };
}

describe('CreateEpicUseCase (RN-894)', () => {
  it('cria o épico quando não há outro com o mesmo título', async () => {
    const { uc, criados, eventos } = montar([epic({ title: 'Outro' })]);
    const criado = await uc.execute('p1', 's1', { title: 'Cadastro' });
    expect(criado.id).toBe('epic-novo');
    expect(criados).toHaveLength(1);
    expect(eventos).toHaveLength(1);
  });

  it('recusa título igual (normalizado) devolvendo o id do existente', async () => {
    const { uc, criados, eventos } = montar([epic()]);
    const p = uc.execute('p1', 's1', { title: '  CADASTRO ' });
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toThrow(
      'Já existe o épico «Cadastro» (id epic-1) neste projeto — use este id em epic_id',
    );
    expect(criados).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });
});
