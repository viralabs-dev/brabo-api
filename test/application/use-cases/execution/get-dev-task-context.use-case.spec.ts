import { describe, it, expect } from 'vitest';
import { GetDevTaskContextUseCase } from '../../../../src/application/use-cases/execution/get-dev-task-context.use-case';
import type {
  StoryRepository,
  TaskRepository,
} from '../../../../src/application/ports/backlog-repository.port';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { ProposedActionRepository } from '../../../../src/application/ports/proposed-action-repository.port';
import type {
  Story,
  Task,
} from '../../../../src/domain/backlog/backlog.entity';
import type { SessionEvent } from '../../../../src/domain/sessions/session-event.entity';
import type { ProposedAction } from '../../../../src/domain/actions/proposed-action.entity';

const now = new Date();

const task: Task = {
  id: 'task-1',
  storyId: 'story-1',
  title: 'Cadastro de usuários',
  description: 'Implementar o endpoint de cadastro',
  status: 'todo',
  assignedTo: null,
  blocked: false,
  blockedReason: null,
  blockedOrigin: null,
  gateStatus: null,
  gateCorrectionCount: 0,
  createdAt: now,
  updatedAt: now,
};

const story: Story = {
  id: 'story-1',
  epicId: 'epic-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  title: 'Cadastro',
  description: '',
  rf: ['deve validar e-mail único'],
  rnf: ['deve responder em até 200ms'],
  businessRuleIds: ['rule-1', 'rule-inexistente'],
  dod: ['testes passando', 'code review aprovado'],
  dor: [],
  moduleIds: ['api'],
  status: 'ready',
  createdAt: now,
  updatedAt: now,
};

const ruleEvent: SessionEvent = {
  id: 'rule-1',
  sessionId: 'sess-1',
  seq: 1,
  type: 'artifact.business_rule',
  actor: { kind: 'agent', id: 'criativo' },
  payload: {
    title: 'E-mail único',
    description: 'Não pode haver dois usuários com o mesmo e-mail',
  },
  createdAt: now,
};

const adrAction: ProposedAction = {
  id: 'action-1',
  projectId: 'proj-1',
  sessionId: 'sess-1',
  seq: 2,
  actionType: 'open_adr_pr',
  payload: {
    title: 'ADR: autenticação via JWT',
    slug: 'adr-jwt',
    content: 'Decisão: usar JWT.',
  },
  status: 'executed',
  resolvedPolicy: 'auto_approve',
  actor: { kind: 'agent', id: 'arquiteto' },
  decidedBy: null,
  decidedAt: null,
  rejectionReason: null,
  executionResult: null,
  createdAt: now,
  updatedAt: now,
};

function adrFor(id: string, title: string, modules?: string[]): ProposedAction {
  return {
    ...adrAction,
    id,
    payload: {
      title,
      slug: id,
      content: `Conteúdo de ${title}`,
      ...(modules === undefined ? {} : { modules }),
    },
  };
}

function buildUseCase(overrides?: {
  task?: Task | null;
  story?: Story | null;
  adrs?: ProposedAction[];
}) {
  const tasks = {
    findById: (id: string) =>
      Promise.resolve(
        overrides?.task !== undefined
          ? overrides.task
          : id === task.id
            ? task
            : null,
      ),
  } as unknown as TaskRepository;

  const stories = {
    findById: (id: string) =>
      Promise.resolve(
        overrides?.story !== undefined
          ? overrides.story
          : id === story.id
            ? story
            : null,
      ),
  } as unknown as StoryRepository;

  const sessionEvents = {
    findById: (id: string) =>
      Promise.resolve(id === ruleEvent.id ? ruleEvent : null),
  } as unknown as SessionEventRepository;

  const proposedActions = {
    listByProjectAndType: () => Promise.resolve(overrides?.adrs ?? [adrAction]),
  } as unknown as ProposedActionRepository;

  return new GetDevTaskContextUseCase(
    tasks,
    stories,
    sessionEvents,
    proposedActions,
  );
}

describe('GetDevTaskContextUseCase', () => {
  it('monta o contexto: story completa, regras resolvidas (ignora id inválido), e ADRs do projeto', async () => {
    const useCase = buildUseCase();

    const ctx = await useCase.execute('proj-1', 'task-1');

    expect(ctx.task.id).toBe('task-1');
    expect(ctx.story.rf).toEqual(['deve validar e-mail único']);
    expect(ctx.story.dod).toEqual(['testes passando', 'code review aprovado']);

    // "rule-inexistente" não resolve (sessionEvents.findById devolve null) —
    // filtrado silenciosamente, sem quebrar o contexto.
    expect(ctx.businessRules).toHaveLength(1);
    expect(ctx.businessRules[0]).toEqual({
      title: 'E-mail único',
      description: 'Não pode haver dois usuários com o mesmo e-mail',
    });

    expect(ctx.adrs).toHaveLength(1);
    expect(ctx.adrs[0]).toEqual({
      title: 'ADR: autenticação via JWT',
      content: 'Decisão: usar JWT.',
      securityRelevant: false,
    });
  });

  describe('filtro de ADR por módulo', () => {
    const adrs = [
      adrFor('adr-transversal', 'Padrão de commits'), // sem `modules`
      adrFor('adr-vazio', 'Convenção de logs', []), // `modules` vazio
      adrFor('adr-api', 'Persistência', ['api']),
      adrFor('adr-web', 'Design system', ['web']),
      adrFor('adr-ambos', 'Contrato HTTP', ['api', 'web']),
    ];

    it('ADR sem módulo declarado é transversal e entra sempre', async () => {
      const useCase = buildUseCase({ adrs });

      const ctx = await useCase.execute('proj-1', 'task-1', 'api');
      const titulos = ctx.adrs.map((a) => a.title);

      // O acervo anterior ao campo `modules` não pode sumir do contexto.
      expect(titulos).toContain('Padrão de commits');
      expect(titulos).toContain('Convenção de logs');
    });

    it('ADR de outro módulo é filtrado', async () => {
      const useCase = buildUseCase({ adrs });

      const ctx = await useCase.execute('proj-1', 'task-1', 'api');
      const titulos = ctx.adrs.map((a) => a.title);

      expect(titulos).toContain('Persistência');
      expect(titulos).toContain('Contrato HTTP');
      expect(titulos).not.toContain('Design system');
    });

    it('sem módulo informado não há filtro (gates QA/SecOps reusam o contexto)', async () => {
      const useCase = buildUseCase({ adrs });

      const ctx = await useCase.execute('proj-1', 'task-1');

      expect(ctx.adrs).toHaveLength(adrs.length);
    });

    it('não vaza o campo `modules` pro contexto do agente', async () => {
      const useCase = buildUseCase({ adrs });

      const ctx = await useCase.execute('proj-1', 'task-1', 'api');

      for (const adr of ctx.adrs) {
        expect(adr).not.toHaveProperty('modules');
      }
    });
  });

  it('falha graciosamente quando a task não existe', async () => {
    const useCase = buildUseCase({ task: null });
    await expect(useCase.execute('proj-1', 'task-inexistente')).rejects.toThrow(
      /não encontrada/,
    );
  });

  it('falha graciosamente quando a story da task não existe (ou é de outro projeto)', async () => {
    const useCase = buildUseCase({ story: null });
    await expect(useCase.execute('proj-1', 'task-1')).rejects.toThrow(
      /não encontrada/,
    );
  });

  it('falha quando a story pertence a outro projeto', async () => {
    const useCase = buildUseCase({
      story: { ...story, projectId: 'outro-projeto' },
    });
    await expect(useCase.execute('proj-1', 'task-1')).rejects.toThrow(
      /não encontrada/,
    );
  });
});
