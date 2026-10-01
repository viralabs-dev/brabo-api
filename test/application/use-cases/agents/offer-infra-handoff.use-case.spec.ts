import { describe, it, expect, beforeEach } from 'vitest';
import { OfferInfraHandoffUseCase } from '../../../../src/application/use-cases/agents/offer-infra-handoff.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AppendSessionEventUseCase } from '../../../../src/application/use-cases/sessions/append-session-event.use-case';
import type { HandoffRepository } from '../../../../src/application/ports/handoff-repository.port';
import type { CicloDeVidaDoHandoff } from '../../../../src/application/use-cases/agents/ciclo-de-vida-do-handoff.service';
import type { StoryRepository } from '../../../../src/application/ports/backlog-repository.port';
import type {
  Story,
  StoryStatus,
} from '../../../../src/domain/backlog/backlog.entity';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeEngine {
  chamadas: string[] = [];

  offerInfraHandoff() {
    this.chamadas.push('infra');
    return Promise.resolve();
  }
}

class FakeEvents {
  tipos: string[] = [];
  execute(_p: string, _s: string, evento: { type: string }) {
    this.tipos.push(evento.type);
    return Promise.resolve({} as never);
  }
}

function fakeStory(status: StoryStatus): Story {
  return {
    id: `story-${status}`,
    epicId: 'epic-1',
    projectId: PROJECT,
    sessionId: SESSION,
    title: 'história de teste',
    description: '',
    rf: [],
    rnf: [],
    businessRuleIds: [],
    dod: [],
    dor: [],
    moduleIds: [],
    status,
    proposedReady: false,
    returnedReason: null,
    returnedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class FakeStoryRepository {
  stories: Story[] = [];
  findByProject(_projectId: string) {
    return Promise.resolve(this.stories);
  }
}

let engine: FakeEngine;
let events: FakeEvents;
let stories: FakeStoryRepository;
let uc: OfferInfraHandoffUseCase;

// ADR 0182 (RN-635): o estado dos dois destinos no projeto.
class FakeHandoffs {
  pendentes = new Set<string>();
  findOfferedToAgentInProject(_p: string, toAgent: string) {
    return Promise.resolve(this.pendentes.has(toAgent) ? [{ toAgent }] : []);
  }
}
class FakeCiclo {
  ativos = new Set<string>();
  sessaoOndeEstaAtivo(_p: string, agent: string) {
    return Promise.resolve(this.ativos.has(agent) ? 's-outra' : null);
  }
}
let handoffs: FakeHandoffs;
let ciclo: FakeCiclo;

beforeEach(() => {
  engine = new FakeEngine();
  events = new FakeEvents();
  stories = new FakeStoryRepository();
  handoffs = new FakeHandoffs();
  ciclo = new FakeCiclo();
  // Caminho feliz por padrão: pelo menos uma história promovida (RN-160).
  stories.stories = [fakeStory('ready')];
  uc = new OfferInfraHandoffUseCase(
    engine as unknown as ApiToEngineClient,
    events as unknown as AppendSessionEventUseCase,
    stories as unknown as StoryRepository,
    handoffs as unknown as HandoffRepository,
    ciclo as unknown as CicloDeVidaDoHandoff,
  );
});

describe('OfferInfraHandoffUseCase', () => {
  // RN-672 (AT-262, ADR 0190): o Dev Lead deixou de ser destino desta
  // confirmação — quem o oferece é a Infra, com o container `running`.
  it('a confirmação de arquitetura pronta entrega SÓ à Infra', async () => {
    await uc.execute(PROJECT, SESSION, 'user-1');

    expect(engine.chamadas).toEqual(['infra']);
  });

  it('grava o marco de arquitetura pronta antes de sinalizar', async () => {
    await uc.execute(PROJECT, SESSION, 'user-1');

    expect(events.tipos).toEqual(['architecture.readiness_confirmed']);
  });

  it('RN-160 revalidada no backend: zero história promovida recusa ANTES de qualquer efeito colateral', async () => {
    stories.stories = [fakeStory('draft')];

    await expect(uc.execute(PROJECT, SESSION, 'user-1')).rejects.toThrow();

    expect(engine.chamadas).toEqual([]);
    expect(events.tipos).toEqual([]);
  });

  it('RN-160: com ao menos uma história ready/in_progress/done, segue o fluxo normal', async () => {
    stories.stories = [fakeStory('draft'), fakeStory('in_progress')];

    await uc.execute(PROJECT, SESSION, 'user-1');

    expect(engine.chamadas).toEqual(['infra']);
    expect(events.tipos).toEqual(['architecture.readiness_confirmed']);
  });

  it('ADR 0182: segundo clique com a oferta à Infra pendente não grava nem chama o engine', async () => {
    handoffs.pendentes = new Set(['infra']);

    const r = await uc.execute(PROJECT, SESSION, 'user-1');

    expect(r.desfecho).toBe('ja_oferecido');
    expect(r.jaAtendidos).toEqual([
      { toAgent: 'infra', motivo: 'oferta_pendente' },
    ]);
    expect(engine.chamadas).toEqual([]);
    expect(events.tipos).toEqual([]);
  });

  it('ADR 0182: Infra já ativa é `ja_oferecido`, e o Dev Lead nunca é acionado daqui (RN-672)', async () => {
    ciclo.ativos = new Set(['infra']);
    // Nem uma oferta pendente ao Dev Lead muda nada: ele não é destino.
    handoffs.pendentes = new Set(['dev-lead']);

    const r = await uc.execute(PROJECT, SESSION, 'user-1');

    expect(r.desfecho).toBe('ja_oferecido');
    expect(r.jaAtendidos).toEqual([
      { toAgent: 'infra', motivo: 'agente_ativo' },
    ]);
    expect(engine.chamadas).toEqual([]);
    expect(events.tipos).toEqual([]);
  });
});
