import { describe, expect, it } from 'vitest';
import { ArtifactProjector } from '../../../src/application/artifact-projection/artifact-projector';
import { ARTIFACT_PROJECTION_AGGREGATE_TYPE } from '../../../src/domain/artifacts/artifact-projection-events';
import { OutboxRepository } from '../../../src/application/ports/outbox-repository.port';
import { SessionEventRepository } from '../../../src/application/ports/session-event-repository.port';
import { ProjectRepository } from '../../../src/application/ports/project-repository.port';
import { ArtifactFileStore } from '../../../src/application/ports/artifact-file-store.port';
import type { OutboxEvent } from '../../../src/domain/shared/outbox-event.entity';
import type { SessionEvent } from '../../../src/domain/sessions/session-event.entity';
import type {
  Project,
  ProjectWorkspaceLocation,
} from '../../../src/domain/iam/project.entity';

/**
 * A projeção dos artefatos em `docs/` (ADR 0148, RN-523).
 *
 * Mesmo desenho do spec do `GraphProjector`: fakes em memória das portas,
 * `new ArtifactProjector(...)` direto (sem Nest) e `drainOnce()` como ponto de
 * entrada. O que estes casos protegem não é o formato do Markdown — é a
 * PROPRIEDADE que dá sentido à projeção: ela nunca perde item, nunca derruba
 * quem a alimenta, e nunca escreve fora da pasta do projeto.
 */

class FakeOutbox implements OutboxRepository {
  rows: OutboxEvent[] = [];
  private seq = 0;

  async append(input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
  }): Promise<void> {
    this.seq += 1;
    this.rows.push({
      id: `outbox-${this.seq}`,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      createdAt: new Date(),
      processedAt: null,
    });
  }

  async listUnprocessed(
    aggregateType: string,
    limit: number,
  ): Promise<OutboxEvent[]> {
    return this.rows
      .filter((r) => r.aggregateType === aggregateType && r.processedAt === null)
      .slice(0, limit);
  }

  async markProcessed(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.processedAt = new Date();
  }
}

class FakeSessionEvents implements SessionEventRepository {
  events = new Map<string, SessionEvent>();

  async append(): Promise<SessionEvent> {
    throw new Error('não usado neste teste');
  }
  async listPaginated(): Promise<never> {
    throw new Error('não usado neste teste');
  }
  async findById(id: string): Promise<SessionEvent | null> {
    return this.events.get(id) ?? null;
  }
  async listByTypeForProject(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
  async listByTypeInSession(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
  async listForProjectInWindow(): Promise<SessionEvent[]> {
    throw new Error('não usado neste teste');
  }
}

class FakeProjects implements ProjectRepository {
  projects = new Map<string, Project>();

  async create(): Promise<Project> {
    throw new Error('não usado neste teste');
  }
  async findById(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }
  async listForWorkspace(): Promise<Project[]> {
    throw new Error('não usado neste teste');
  }
  async listRunnerModeReachableBy(): Promise<Project[]> {
    throw new Error('não usado neste teste');
  }
  async update(): Promise<Project | null> {
    throw new Error('não usado neste teste');
  }
  async remove(): Promise<Project | null> {
    throw new Error('não usado neste teste');
  }
  async addMember(): Promise<never> {
    throw new Error('não usado neste teste');
  }
  async findMemberRole(): Promise<never> {
    throw new Error('não usado neste teste');
  }
  async listMembers(): Promise<never> {
    throw new Error('não usado neste teste');
  }
  async removeMember(): Promise<void> {
    throw new Error('não usado neste teste');
  }
}

interface Escrita {
  local: ProjectWorkspaceLocation;
  agente: string;
  arquivo: string;
  conteudo: string;
}

class FakeArtifactFiles implements ArtifactFileStore {
  escritas: Escrita[] = [];
  falharCom: Error | null = null;

  async write(
    local: ProjectWorkspaceLocation,
    agente: string,
    arquivo: string,
    conteudo: string,
  ): Promise<void> {
    if (this.falharCom) throw this.falharCom;
    this.escritas.push({ local, agente, arquivo, conteudo });
  }
}

const PROJETO_ID = 'proj-1';

function projeto(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJETO_ID,
    workspaceId: 'ws-1',
    name: 'Loja',
    slug: 'loja',
    workspaceDirName: 'loja-abc123',
    executionMode: 'container',
    workspacePath: null,
    ...overrides,
  } as Project;
}

function evento(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    seq: 7,
    type: 'artifact.decision_record',
    actor: { kind: 'agent', id: 'arquiteto' },
    payload: { choice: 'Cache de sessão em Redis' },
    createdAt: new Date('2026-09-06T12:00:00Z'),
    ...overrides,
  };
}

function montar(opts: {
  outbox: FakeOutbox;
  sessionEvents: FakeSessionEvents;
  projects: FakeProjects;
  arquivos: FakeArtifactFiles;
}) {
  return new ArtifactProjector(
    opts.outbox,
    opts.sessionEvents,
    opts.projects,
    opts.arquivos,
  );
}

function cenario(over: { evento?: SessionEvent; projeto?: Project } = {}) {
  const outbox = new FakeOutbox();
  const sessionEvents = new FakeSessionEvents();
  const projects = new FakeProjects();
  const arquivos = new FakeArtifactFiles();

  const ev = over.evento ?? evento();
  sessionEvents.events.set(ev.id, ev);
  projects.projects.set(PROJETO_ID, over.projeto ?? projeto());

  return {
    outbox,
    sessionEvents,
    projects,
    arquivos,
    projector: montar({ outbox, sessionEvents, projects, arquivos }),
    async enfileirar(ev2: SessionEvent = ev) {
      await outbox.append({
        aggregateType: ARTIFACT_PROJECTION_AGGREGATE_TYPE,
        aggregateId: PROJETO_ID,
        eventType: ev2.type,
        payload: { eventId: ev2.id },
      });
    },
  };
}

describe('ArtifactProjector — caminho feliz', () => {
  it('escreve o artefato na pasta do AGENTE que o emitiu', async () => {
    const c = cenario();
    await c.enfileirar();

    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(1);
    const [escrita] = c.arquivos.escritas;
    expect(escrita.agente).toBe('arquiteto');
    expect(escrita.arquivo).toBe('decision_record-cache-de-sessao-em-redis-7.md');
    expect(escrita.conteudo).toContain('Cache de sessão em Redis');
    // O arquivo se declara derivado — quem abrir precisa saber que editar ali
    // não muda nada.
    expect(escrita.conteudo).toContain('GERADO a partir do event log');
    expect(escrita.conteudo).toContain('evt-1');
  });

  it('tipo VERSIONADO sobrescreve o mesmo arquivo — a pasta mostra o vigente', async () => {
    const v1 = evento({
      id: 'evt-c4-1',
      seq: 3,
      type: 'artifact.c4_diagram',
      payload: { version: 1 },
    });
    const c = cenario({ evento: v1 });
    const v2 = evento({
      id: 'evt-c4-2',
      seq: 9,
      type: 'artifact.c4_diagram',
      payload: { version: 2 },
    });
    c.sessionEvents.events.set(v2.id, v2);

    await c.enfileirar(v1);
    await c.enfileirar(v2);
    await c.projector.drainOnce();

    // Dois eventos, DOIS writes — mas para o MESMO nome, que é o que faz o
    // segundo sobrescrever o primeiro em disco.
    expect(c.arquivos.escritas.map((e) => e.arquivo)).toEqual([
      'c4_diagram.md',
      'c4_diagram.md',
    ]);
  });

  it('append-only do mesmo tipo e mesmo título não colide — o seq desempata', async () => {
    const a = evento({ id: 'evt-a', seq: 4 });
    const c = cenario({ evento: a });
    const b = evento({ id: 'evt-b', seq: 5 });
    c.sessionEvents.events.set(b.id, b);

    await c.enfileirar(a);
    await c.enfileirar(b);
    await c.projector.drainOnce();

    const nomes = c.arquivos.escritas.map((e) => e.arquivo);
    expect(new Set(nomes).size).toBe(2);
    expect(nomes[0]).toContain('-4.md');
    expect(nomes[1]).toContain('-5.md');
  });

  it('passa a LOCALIZAÇÃO do projeto adiante — é ela que decide onde a pasta mora', async () => {
    const c = cenario({
      projeto: projeto({
        executionMode: 'runner',
        workspacePath: '/home/voce/dev/loja',
      }),
    });
    await c.enfileirar();

    await c.projector.drainOnce();

    // O projetor NÃO decide o caminho — ele entrega a localização, e
    // `pastaDeArtefatosDoProjeto` é quem sabe que `runner` desvia para a raiz
    // gerenciada. Duplicar essa decisão aqui seria a segunda derivação que um
    // dia diverge.
    expect(c.arquivos.escritas[0].local.executionMode).toBe('runner');
    expect(c.arquivos.escritas[0].local.workspaceDirName).toBe('loja-abc123');
  });

  it('marca processado só o que escreveu', async () => {
    const c = cenario();
    await c.enfileirar();

    await c.projector.drainOnce();

    expect(c.outbox.rows[0].processedAt).not.toBeNull();
  });
});

describe('ArtifactProjector — degradação', () => {
  it('falha de escrita deixa a linha NÃO processada, para o ciclo seguinte', async () => {
    const c = cenario();
    c.arquivos.falharCom = new Error('EACCES: permissão negada');
    await c.enfileirar();

    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(0);
    expect(c.outbox.rows[0].processedAt).toBeNull();
  });

  it('o ciclo seguinte retenta, e converge quando o destino volta', async () => {
    const c = cenario();
    c.arquivos.falharCom = new Error('disco cheio');
    await c.enfileirar();
    await c.projector.drainOnce();

    c.arquivos.falharCom = null;
    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(1);
    expect(c.outbox.rows[0].processedAt).not.toBeNull();
  });

  it('uma falha não bloqueia os outros itens do MESMO lote', async () => {
    const c = cenario();
    const bom = evento({ id: 'evt-bom', seq: 11 });
    c.sessionEvents.events.set(bom.id, bom);

    // O primeiro item aponta pra um evento que não existe: erro no item, não
    // no destino. O segundo tem que ser escrito assim mesmo.
    await c.outbox.append({
      aggregateType: ARTIFACT_PROJECTION_AGGREGATE_TYPE,
      aggregateId: PROJETO_ID,
      eventType: 'artifact.note',
      payload: { eventId: 'evt-que-sumiu' },
    });
    await c.enfileirar(bom);

    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(1);
    expect(c.arquivos.escritas[0].arquivo).toContain('-11.md');
  });

  it('evento que sumiu do event log não é retentado para sempre', async () => {
    const c = cenario();
    await c.outbox.append({
      aggregateType: ARTIFACT_PROJECTION_AGGREGATE_TYPE,
      aggregateId: PROJETO_ID,
      eventType: 'artifact.note',
      payload: { eventId: 'evt-que-sumiu' },
    });

    await c.projector.drainOnce();

    // Marcado, e nada escrito: retentar um evento que não existe mais não
    // teria efeito nenhum, e a linha ficaria na fila para sempre.
    expect(c.outbox.rows[0].processedAt).not.toBeNull();
    expect(c.arquivos.escritas).toHaveLength(0);
  });

  it('projeto que sumiu não derruba o ciclo', async () => {
    const c = cenario();
    c.projects.projects.clear();
    await c.enfileirar();

    await expect(c.projector.drainOnce()).resolves.toBeUndefined();
    expect(c.arquivos.escritas).toHaveLength(0);
  });

  it('reprocessar é idempotente — o mesmo nome, o mesmo conteúdo', async () => {
    const c = cenario();
    await c.enfileirar();
    await c.projector.drainOnce();

    // Simula a linha voltando para a fila (o que o retry faz).
    c.outbox.rows[0].processedAt = null;
    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(2);
    expect(c.arquivos.escritas[0].arquivo).toBe(c.arquivos.escritas[1].arquivo);
    expect(c.arquivos.escritas[0].conteudo).toBe(c.arquivos.escritas[1].conteudo);
  });

  it('só drena o próprio aggregate_type — não rouba a linha do grafo nem a do engine', async () => {
    const c = cenario();
    await c.outbox.append({
      aggregateType: 'session',
      aggregateId: 'sess-1',
      eventType: 'session_event.appended',
      payload: { eventId: 'evt-1' },
    });
    await c.outbox.append({
      aggregateType: 'graph_projection',
      aggregateId: 'sess-1',
      eventType: 'handoff.offered',
      payload: { eventId: 'evt-1' },
    });

    await c.projector.drainOnce();

    expect(c.arquivos.escritas).toHaveLength(0);
    expect(c.outbox.rows.every((r) => r.processedAt === null)).toBe(true);
  });
});
