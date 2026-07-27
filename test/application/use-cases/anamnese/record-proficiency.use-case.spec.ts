import { describe, it, expect, vi } from 'vitest';
import { RecordProficiencyUseCase } from '../../../../src/application/use-cases/anamnese/record-proficiency.use-case';
import type { UnitOfWork } from '../../../../src/application/ports/unit-of-work.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ModuleMapRepository } from '../../../../src/application/ports/module-map-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { SessionRepository } from '../../../../src/application/ports/session-repository.port';
import type {
  AnamneseOptOutRepository,
  ProficiencyProfileRepository,
} from '../../../../src/application/ports/proficiency-profile-repository.port';
import type { AnamneseRunRepository } from '../../../../src/application/ports/anamnese-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ProficiencyDraft } from '../../../../src/domain/anamnese/proficiency-validation';

const now = new Date();

function buildDraft(
  overrides: Partial<ProficiencyDraft> = {},
): ProficiencyDraft {
  return {
    userId: 'user-1',
    competency: 'nestjs',
    level: 'avancado',
    rationale: 'corrigiu o dev-api duas vezes no mesmo detalhe de DI',
    evidenceEventIds: ['evt-1'],
    ...overrides,
  };
}

function buildHarness(
  opts: {
    stacks?: string[];
    optedOut?: string[];
    // sessionId de cada evento conhecido; ausente = evento inexistente
    events?: Record<string, string>;
    // sessões que pertencem ao projeto
    sessionsInProject?: string[];
  } = {},
) {
  const events = opts.events ?? { 'evt-1': 'sess-1' };
  const sessionsInProject = new Set(opts.sessionsInProject ?? ['sess-1']);

  const unitOfWork = {
    runInTransaction: (work: () => Promise<unknown>) => work(),
  } as unknown as UnitOfWork;

  const projects = {
    listMembers: () =>
      Promise.resolve([
        { userId: 'user-1', name: 'Dani', email: 'd@x.dev', role: 'owner' },
      ]),
  } as unknown as ProjectRepository;

  const moduleMaps = {
    findCurrent: () =>
      Promise.resolve(
        opts.stacks
          ? { modules: opts.stacks.map((stack) => ({ stack })) }
          : null,
      ),
  } as unknown as ModuleMapRepository;

  const sessionEvents = {
    findById: (id: string) =>
      Promise.resolve(events[id] ? { id, sessionId: events[id] } : null),
  } as unknown as SessionEventRepository;

  const sessions = {
    findInProject: (_p: string, sessionId: string) =>
      Promise.resolve(
        sessionsInProject.has(sessionId) ? { id: sessionId } : null,
      ),
  } as unknown as SessionRepository;

  const upsertMany = vi.fn((rows: Record<string, unknown>[]) =>
    Promise.resolve(
      rows.map((r, i) => ({ ...r, id: `prof-${i + 1}`, updatedAt: now })),
    ),
  );
  const profiles = { upsertMany } as unknown as ProficiencyProfileRepository;

  const optOuts = {
    listOptedOutUserIds: () => Promise.resolve(opts.optedOut ?? []),
  } as unknown as AnamneseOptOutRepository;

  const create = vi.fn(() => Promise.resolve({ id: 'run-1' }));
  const runs = { create } as unknown as AnamneseRunRepository;

  const appendEvent = vi.fn(() => Promise.resolve({}));
  const appendSessionEvent = {
    execute: appendEvent,
  } as unknown as AppendSessionEventUseCase;

  return {
    useCase: new RecordProficiencyUseCase(
      unitOfWork,
      projects,
      moduleMaps,
      sessionEvents,
      sessions,
      profiles,
      optOuts,
      runs,
      appendSessionEvent,
    ),
    upsertMany,
    create,
    appendEvent,
  };
}

function input(profiles: ProficiencyDraft[]) {
  return {
    sessionId: 'sess-1',
    windowFrom: new Date(now.getTime() - 3600_000),
    windowTo: now,
    eventCount: 42,
    profiles,
  };
}

describe('RecordProficiencyUseCase', () => {
  it('caminho feliz: grava o perfil e a rodada, narrando cada perfil', async () => {
    const { useCase, upsertMany, create, appendEvent } = buildHarness({
      stacks: ['NestJS'],
    });

    await useCase.execute('proj-1', input([buildDraft()]));

    expect(upsertMany).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'anamnese.profile_updated' }),
    );
    expect(appendEvent).toHaveBeenCalledWith(
      'proj-1',
      'sess-1',
      expect.objectContaining({ type: 'anamnese.run_completed' }),
    );
  });

  it('stack composta libera a tecnologia isolada (o caso que travava tudo)', async () => {
    const { useCase, upsertMany } = buildHarness({
      stacks: ['NestJS + Drizzle + Postgres'],
    });

    await useCase.execute(
      'proj-1',
      input([buildDraft({ competency: 'drizzle' })]),
    );

    expect(upsertMany).toHaveBeenCalledTimes(1);
  });

  it('competência fora do catálogo rejeita o LOTE e nada é gravado', async () => {
    const { useCase, upsertMany, create } = buildHarness({
      stacks: ['NestJS'],
    });

    await expect(
      useCase.execute(
        'proj-1',
        input([buildDraft(), buildDraft({ competency: 'ansiedade' })]),
      ),
    ).rejects.toThrow();
    expect(upsertMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('competência é NORMALIZADA na gravação (o unique é case-sensitive)', async () => {
    const { useCase, upsertMany } = buildHarness({ stacks: ['NestJS'] });

    await useCase.execute(
      'proj-1',
      input([buildDraft({ competency: '  NestJS  ' })]),
    );

    expect(upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ competency: 'nestjs' }),
    ]);
  });

  it('mesma (user, competência) duas vezes no lote vira erro corrigível, não 500', async () => {
    // O upsert é um INSERT ... ON CONFLICT DO UPDATE só: o Postgres recusa
    // afetar a mesma linha duas vezes e o modelo recebia um 500 opaco.
    const { useCase, upsertMany } = buildHarness({ stacks: ['NestJS'] });

    await expect(
      useCase.execute(
        'proj-1',
        input([buildDraft(), buildDraft({ competency: 'NestJS' })]),
      ),
    ).rejects.toThrow(/duas vezes/);
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('usuário que optou por sair não pode ser perfilado', async () => {
    const { useCase, upsertMany } = buildHarness({
      stacks: ['NestJS'],
      optedOut: ['user-1'],
    });

    await expect(
      useCase.execute('proj-1', input([buildDraft()])),
    ).rejects.toThrow();
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('evidência de sessão de OUTRO projeto é rejeitada', async () => {
    // A mensagem já prometia "deste projeto", mas a checagem aceitava
    // qualquer event id que existisse no banco.
    const { useCase, upsertMany } = buildHarness({
      stacks: ['NestJS'],
      events: { 'evt-alheio': 'sess-de-outro-projeto' },
      sessionsInProject: ['sess-1'],
    });

    await expect(
      useCase.execute(
        'proj-1',
        input([buildDraft({ evidenceEventIds: ['evt-alheio'] })]),
      ),
    ).rejects.toThrow();
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it('evidência inexistente é rejeitada', async () => {
    const { useCase, upsertMany } = buildHarness({ stacks: ['NestJS'] });

    await expect(
      useCase.execute(
        'proj-1',
        input([buildDraft({ evidenceEventIds: ['evt-x'] })]),
      ),
    ).rejects.toThrow();
    expect(upsertMany).not.toHaveBeenCalled();
  });
});
