import { describe, it, expect, beforeEach } from 'vitest';
import { RequestParallelizationUseCase } from '../../../../src/application/use-cases/execution/request-parallelization.use-case';
import type { SessionEventRepository } from '../../../../src/application/ports/session-event-repository.port';
import type { AgentAreaRepository } from '../../../../src/application/ports/agent-area-repository.port';
import type { ProposeActionUseCase } from '../../../../src/application/use-cases/actions/propose-action.use-case';
import type { AcceptParallelizationUseCase } from '../../../../src/application/use-cases/execution/accept-parallelization.use-case';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeEvents {
  ativados: { sessionId: string; modules: string[] }[] = [];
  aceites: { sessionId: string }[] = [];

  listByTypeForProject(_projectId: string, type: string) {
    if (type === 'execution.activated') {
      return Promise.resolve(
        this.ativados.map((a) => ({
          sessionId: a.sessionId,
          payload: { modules: a.modules },
        })),
      );
    }
    return Promise.resolve(this.aceites.map((a) => ({ ...a, payload: {} })));
  }
}

class FakeAreas {
  maxParallel: number | null = 2;
  findByKey() {
    return Promise.resolve(
      this.maxParallel == null
        ? null
        : {
            id: 'a1',
            projectId: PROJECT,
            key: 'dev',
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
    const i = input as unknown as {
      actionType: string;
      actor: unknown;
      payload: unknown;
    };
    this.chamadas.push(i);
    return Promise.resolve({ id: 'act-1' } as never);
  }
}

class FakeAccept {
  chamadas: string[] = [];
  execute(_p: string, _s: string, module: string) {
    this.chamadas.push(module);
    return Promise.resolve({ ok: true as const });
  }
}

let events: FakeEvents;
let areas: FakeAreas;
let propose: FakePropose;
let accept: FakeAccept;
let uc: RequestParallelizationUseCase;

beforeEach(() => {
  events = new FakeEvents();
  areas = new FakeAreas();
  propose = new FakePropose();
  accept = new FakeAccept();
  uc = new RequestParallelizationUseCase(
    events as unknown as SessionEventRepository,
    areas as unknown as AgentAreaRepository,
    propose as unknown as ProposeActionUseCase,
    accept as unknown as AcceptParallelizationUseCase,
  );
});

describe('RequestParallelizationUseCase', () => {
  it('dentro do teto: executa direto, sem pedir nada', async () => {
    events.ativados = [{ sessionId: SESSION, modules: ['api'] }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('executado');
    expect(accept.chamadas).toEqual(['api']);
    expect(propose.chamadas).toHaveLength(0);
  });

  it('acima do teto: vira proposed_action e NÃO executa', async () => {
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web'] }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('aguardando_autorizacao');
    // O ponto: nada subiu. Se `accept` rodasse, a autorização seria teatro.
    expect(accept.chamadas).toHaveLength(0);
    expect(propose.chamadas[0]!.actionType).toBe('parallelize');
  });

  it('quem PEDE é o lead, não o usuário', async () => {
    // O pipeline distingue quem pede de quem decide — é isso que faz o event
    // log contar a história certa depois.
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web'] }];

    await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(propose.chamadas[0]!.actor).toEqual({
      kind: 'agent',
      id: 'dev-lead',
    });
  });

  it('o teto é da SESSÃO: módulos diferentes somam', async () => {
    // Três agentes espalhados em três módulos ocupam a sessão inteira.
    // Contar por módulo diria "cada um tem 1, pode subir".
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web', 'infra'] }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('aguardando_autorizacao');
  });

  it('aceites anteriores contam no total', async () => {
    events.ativados = [{ sessionId: SESSION, modules: ['api'] }];
    events.aceites = [{ sessionId: SESSION }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('aguardando_autorizacao');
  });

  it('agente de OUTRA sessão não conta', async () => {
    // O teto é desta sessão. Somar as outras faria um projeto movimentado
    // pedir autorização para o primeiro agente de uma sessão nova.
    events.ativados = [
      { sessionId: 'outra', modules: ['api', 'web', 'infra'] },
      { sessionId: SESSION, modules: ['api'] },
    ];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('executado');
  });

  it('projeto sem área de dev usa o default 2', async () => {
    areas.maxParallel = null;
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web'] }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('aguardando_autorizacao');
  });

  it('teto maior configurado pelo usuário dispensa a autorização', async () => {
    areas.maxParallel = 5;
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web', 'infra'] }];

    const r = await uc.execute(PROJECT, SESSION, 'api', 'u1');

    expect(r.estado).toBe('executado');
  });

  it('o motivo no payload diz os três números', async () => {
    // Vai para o payload IMUTÁVEL da ação: quem ler depois precisa entender
    // o que foi autorizado sem reconstruir o estado.
    events.ativados = [{ sessionId: SESSION, modules: ['api', 'web'] }];

    await uc.execute(PROJECT, SESSION, 'api', 'u1');

    const payload = propose.chamadas[0]!.payload as { motivo: string };
    expect(payload.motivo).toContain('já tem 2');
    expect(payload.motivo).toContain('teto de 2');
  });
});
