import { describe, it, expect, beforeEach } from 'vitest';
import { AcceptHandoffUseCase } from '../../../../src/application/use-cases/agents/accept-handoff.use-case';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { AgentAutonomyRepository } from '../../../../src/application/ports/agent-autonomy-repository.port';
import type { ProjectRepository } from '../../../../src/application/ports/project-repository.port';
import type { ProvisionedRepositoryRepository } from '../../../../src/application/ports/provisioned-repository-repository.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { ProvisionRepositoryUseCase } from '../../../../src/application/use-cases/git/provision-repository.use-case';
import type { ActivateAgentUseCase } from '../../../../src/application/use-cases/agents/activate-agent.use-case';
import type { ProvisionedRepository } from '../../../../src/domain/git/provisioned-repository.entity';

/**
 * O aceite do handoff, e o repositório que nasce nele (RN-522).
 *
 * O que estes casos protegem é a ORDEM e a CONTENÇÃO: criar projeto deixou de
 * provisionar (RN-541), então se este gatilho falhar em silêncio um projeto
 * fica sem repositório para sempre — e se ele derrubar o aceite, o Dev Lead
 * nunca acorda por causa de uma falha de git.
 */
const PROJECT = 'p1';
const SESSION = 's1';
const HANDOFF = 'h1';
const USER = 'u1';

interface HandoffFake {
  id: string;
  sessionId: string;
  toAgent: string;
  status: string;
}

class FakeHandoffs {
  handoff: HandoffFake = {
    id: HANDOFF,
    sessionId: SESSION,
    toAgent: 'dev-lead',
    status: 'offered',
  };

  findById(id: string) {
    return Promise.resolve(this.handoff.id === id ? this.handoff : null);
  }

  updateStatus(_id: string, status: string) {
    this.handoff = { ...this.handoff, status };
    return Promise.resolve(this.handoff);
  }
}

class FakeAutonomy {
  upserts: string[] = [];
  upsert(_p: string, agente: string, tipo: string, _policy: string) {
    this.upserts.push(`${agente}:${tipo}`);
    return Promise.resolve({} as never);
  }
}

class FakeEvents {
  eventos: { type: string; payload?: Record<string, unknown> }[] = [];
  execute(
    _p: string,
    _s: string,
    evento: { type: string; payload?: Record<string, unknown> },
  ) {
    this.eventos.push(evento);
    return Promise.resolve({} as never);
  }
  tipos() {
    return this.eventos.map((e) => e.type);
  }
}

class FakeActivate {
  ativados: string[] = [];
  execute(_p: string, _s: string, agente: string, _u: string) {
    this.ativados.push(agente);
    return Promise.resolve({} as never);
  }
}

class FakeProjects {
  projeto: { id: string; slug: string } | null = { id: PROJECT, slug: 'loja' };
  findById(_id: string) {
    return Promise.resolve(this.projeto);
  }
}

class FakeRepositories {
  existente: ProvisionedRepository | null = null;
  findByProjectId(_p: string) {
    return Promise.resolve(this.existente);
  }
}

class FakeProvision {
  chamadas: { projectId: string; userId: string; input: unknown }[] = [];
  erro: Error | null = null;

  execute(projectId: string, userId: string, input: unknown) {
    if (this.erro) return Promise.reject(this.erro);
    this.chamadas.push({ projectId, userId, input });
    return Promise.resolve({} as never);
  }
}

let handoffs: FakeHandoffs;
let autonomy: FakeAutonomy;
let events: FakeEvents;
let activate: FakeActivate;
let projects: FakeProjects;
let repositories: FakeRepositories;
let provision: FakeProvision;
let uc: AcceptHandoffUseCase;

beforeEach(() => {
  handoffs = new FakeHandoffs();
  autonomy = new FakeAutonomy();
  events = new FakeEvents();
  activate = new FakeActivate();
  projects = new FakeProjects();
  repositories = new FakeRepositories();
  provision = new FakeProvision();
  uc = new AcceptHandoffUseCase(
    handoffs as unknown as HandoffRepository,
    autonomy as unknown as AgentAutonomyRepository,
    events as unknown as AppendSessionEventUseCase,
    activate as unknown as ActivateAgentUseCase,
    projects as unknown as ProjectRepository,
    repositories as unknown as ProvisionedRepositoryRepository,
    provision as unknown as ProvisionRepositoryUseCase,
  );
});

describe('AcceptHandoffUseCase — o repositório nasce no handoff (RN-522)', () => {
  it('aceitar para o Dev Lead provisiona `local` com o slug do projeto', async () => {
    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    expect(provision.chamadas).toHaveLength(1);
    expect(provision.chamadas[0]).toMatchObject({
      projectId: PROJECT,
      userId: USER,
      // `local` é o único provider que não pede credencial — é o que torna o
      // provisionamento automático possível, sem ninguém escolher hospedagem
      // no meio do aceite.
      input: { provider: 'local', name: 'loja', visibility: 'private' },
    });
    expect(handoffs.handoff.status).toBe('accepted');
    expect(activate.ativados).toEqual(['dev-lead']);
  });

  it('aceitar para OUTRO agente não provisiona nada', async () => {
    handoffs.handoff = { ...handoffs.handoff, toAgent: 'po' };

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    expect(provision.chamadas).toHaveLength(0);
    expect(activate.ativados).toEqual(['po']);
  });

  it('o handoff para a Infra continua semeando autonomia, e não provisiona', async () => {
    handoffs.handoff = { ...handoffs.handoff, toAgent: 'infra' };

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    expect(autonomy.upserts).toEqual(['infra:open_infra_pr', 'infra:terminal']);
    expect(provision.chamadas).toHaveLength(0);
  });

  // O caso de falha que dá sentido ao desenho: sem transação, o aceite já está
  // commitado quando o provisionamento roda. Um throw devolveria 500 sobre um
  // handoff que no banco foi aceito, e ainda impediria a ativação do agente.
  it('provisionamento que falha NÃO derruba o aceite nem a ativação', async () => {
    provision.erro = new Error('permissão negada: /data/git-repos/loja.git');

    await expect(
      uc.execute(PROJECT, SESSION, HANDOFF, USER),
    ).resolves.toBeDefined();

    expect(handoffs.handoff.status).toBe('accepted');
    expect(activate.ativados).toEqual(['dev-lead']);
  });

  it('a falha vira evento nomeado, com origem e a mensagem real', async () => {
    provision.erro = new Error('permissão negada: /data/git-repos/loja.git');

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    const falha = events.eventos.find(
      (e) => e.type === 'repository.provision_failed',
    );
    expect(falha).toBeDefined();
    expect(falha?.payload).toMatchObject({ origem: 'infra' });
    expect(String(falha?.payload?.error)).toContain('permissão negada');
    // O desfecho fica no log DEPOIS do aceite — a ordem importa para quem lê
    // a timeline: primeiro o handoff foi aceito, depois o git falhou.
    expect(events.tipos()).toEqual([
      'handoff.accepted',
      'repository.provision_failed',
    ]);
  });

  it('projeto que ADOTOU repositório não provisiona, e isso não é falha', async () => {
    // `ProvisionRepository` recusaria com ConflictException de propósito
    // (RN-045). Mas o projeto TEM repositório: chamar e registrar a recusa
    // como falha mentiria sobre o estado dele.
    repositories.existente = {
      origin: 'adopted',
    } as unknown as ProvisionedRepository;

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    expect(provision.chamadas).toHaveLength(0);
    expect(events.tipos()).toEqual(['handoff.accepted']);
    expect(activate.ativados).toEqual(['dev-lead']);
  });

  it('repositório já CRIADO cai no caso de uso, que é idempotente por desenho', async () => {
    repositories.existente = {
      origin: 'created',
    } as unknown as ProvisionedRepository;

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    // Não pula: rodar de novo converge com todos os passos reportando
    // satisfeito, e é assim que um bootstrap interrompido se completa.
    expect(provision.chamadas).toHaveLength(1);
    expect(events.tipos()).toEqual(['handoff.accepted']);
  });

  it('projeto sumido vira falha nomeada, nunca crash silencioso', async () => {
    projects.projeto = null;

    await uc.execute(PROJECT, SESSION, HANDOFF, USER);

    expect(provision.chamadas).toHaveLength(0);
    expect(events.tipos()).toContain('repository.provision_failed');
    expect(activate.ativados).toEqual(['dev-lead']);
  });

  it('handoff que não está `offered` é recusado antes de qualquer efeito', async () => {
    handoffs.handoff = { ...handoffs.handoff, status: 'accepted' };

    await expect(uc.execute(PROJECT, SESSION, HANDOFF, USER)).rejects.toThrow(
      /offered/,
    );
    expect(provision.chamadas).toHaveLength(0);
    expect(activate.ativados).toHaveLength(0);
  });
});
