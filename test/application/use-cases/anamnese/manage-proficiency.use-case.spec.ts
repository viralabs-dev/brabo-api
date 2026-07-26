import { describe, it, expect, vi } from 'vitest';
import {
  DeleteProficiencyProfileUseCase,
  ListProficiencyProfilesUseCase,
  SetAnamneseOptInUseCase,
} from '../../../../src/application/use-cases/anamnese/manage-proficiency.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../../../src/application/ports/proficiency-profile-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ResolveEffectiveRoleUseCase } from '../../../../src/application/use-cases/iam/resolve-effective-role.use-case';
import type { Role } from '../../../../src/domain/iam/role';

const MEMBROS = [
  {
    userId: 'user-9',
    role: 'owner' as Role,
    name: 'Dani',
    email: 'dani@brabo.dev',
  },
];

function buildHarness(role: Role | null, membros = MEMBROS) {
  const listByProject = vi.fn(() =>
    Promise.resolve([
      { id: 'todos', userId: 'user-9' },
      { id: 'de-outro', userId: 'user-fantasma' },
    ] as never),
  );
  const listByUser = vi.fn(() =>
    Promise.resolve([{ id: 'meu', userId: 'user-9' }] as never),
  );
  const deleteByUser = vi.fn(() => Promise.resolve(3));

  const profiles = {
    listByProject,
    listByUser,
    deleteByUser,
  } as unknown as ProficiencyProfileRepository;

  const optOut = vi.fn(() => Promise.resolve());
  const optIn = vi.fn(() => Promise.resolve());
  const optOuts = { optOut, optIn } as unknown as AnamneseOptOutRepository;

  const projects = {
    listMembers: () => Promise.resolve(membros),
  } as unknown as ProjectRepository;

  const resolveEffectiveRole = {
    forProject: () => Promise.resolve(role),
  } as unknown as ResolveEffectiveRoleUseCase;

  const unitOfWork = {
    runInTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as UnitOfWork;

  return {
    list: new ListProficiencyProfilesUseCase(
      profiles,
      projects,
      resolveEffectiveRole,
    ),
    del: new DeleteProficiencyProfileUseCase(unitOfWork, profiles, optOuts),
    setOptIn: new SetAnamneseOptInUseCase(optOuts),
    listByProject,
    listByUser,
    deleteByUser,
    optOut,
    optIn,
  };
}

describe('ListProficiencyProfilesUseCase', () => {
  // Perfil de competência é dado SOBRE a pessoa: o default menos surpreendente
  // é ela ver o dela. A leitura de time fica com quem administra o projeto.
  it.each(['owner', 'maintainer'] as Role[])(
    '%s enxerga o perfil do time inteiro',
    async (role) => {
      const { list, listByProject, listByUser } = buildHarness(role);

      await list.execute('proj-1', 'user-9');

      expect(listByProject).toHaveBeenCalledWith('proj-1');
      expect(listByUser).not.toHaveBeenCalled();
    },
  );

  it.each(['developer', 'viewer'] as Role[])(
    '%s enxerga só o próprio perfil',
    async (role) => {
      const { list, listByProject, listByUser } = buildHarness(role);

      await list.execute('proj-1', 'user-9');

      expect(listByUser).toHaveBeenCalledWith('proj-1', 'user-9');
      expect(listByProject).not.toHaveBeenCalled();
    },
  );

  it('identifica a pessoa por e-mail, não pelo UUID', async () => {
    // A tela usava o `userId` cru como cabeçalho do grupo, enquanto o resto do
    // app identifica pessoa por e-mail.
    const { list } = buildHarness('developer');

    const [perfil] = await list.execute('proj-1', 'user-9');

    expect(perfil.userEmail).toBe('dani@brabo.dev');
    expect(perfil.userName).toBe('Dani');
  });

  it('perfil de quem já não é membro fica sem e-mail (a UI cai no id)', async () => {
    // O perfil sobrevive à remoção do membro — não pode quebrar a listagem.
    const { list } = buildHarness('owner');

    const perfis = await list.execute('proj-1', 'user-9');
    const fantasma = perfis.find((p) => p.userId === 'user-fantasma');

    expect(fantasma?.userEmail).toBeNull();
    expect(fantasma?.userName).toBeNull();
  });

  it('sem papel resolvido cai no caminho restrito, não no agregado', async () => {
    const { list, listByProject, listByUser } = buildHarness(null);

    await list.execute('proj-1', 'user-9');

    expect(listByUser).toHaveBeenCalled();
    expect(listByProject).not.toHaveBeenCalled();
  });
});

describe('DeleteProficiencyProfileUseCase', () => {
  it('apaga E grava o opt-out — sem o opt-out o apagar seria cosmético', async () => {
    const { del, deleteByUser, optOut } = buildHarness('viewer');

    const result = await del.execute('proj-1', 'user-9');

    expect(deleteByUser).toHaveBeenCalledWith('proj-1', 'user-9');
    expect(optOut).toHaveBeenCalledWith('proj-1', 'user-9');
    expect(result).toEqual({ deleted: 3, optedOut: true });
  });
});

describe('SetAnamneseOptInUseCase', () => {
  it('reverte o opt-out', async () => {
    const { setOptIn, optIn } = buildHarness('viewer');

    const result = await setOptIn.execute('proj-1', 'user-9');

    expect(optIn).toHaveBeenCalledWith('proj-1', 'user-9');
    expect(result).toEqual({ optedOut: false });
  });
});
