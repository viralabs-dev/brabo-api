import { describe, it, expect, beforeEach } from 'vitest';
import { CancelAgentTurnUseCase } from '../../../../src/application/use-cases/agents/cancel-agent-turn.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';

const PROJECT = 'p1';
const SESSION = 's1';

class FakeEngine {
  chamadas: Array<{ projectId: string; sessionId: string; agent: string }> = [];
  falhar = false;

  cancelAgentTurn(projectId: string, sessionId: string, agent: string) {
    if (this.falhar) return Promise.reject(new Error('engine fora do ar'));
    this.chamadas.push({ projectId, sessionId, agent });
    return Promise.resolve();
  }
}

let engine: FakeEngine;
let uc: CancelAgentTurnUseCase;

beforeEach(() => {
  engine = new FakeEngine();
  uc = new CancelAgentTurnUseCase(engine as unknown as ApiToEngineClient);
});

describe('CancelAgentTurnUseCase', () => {
  it('roteia o cancelamento pro engine com projeto/sessão/agente', async () => {
    const resultado = await uc.execute(PROJECT, SESSION, 'po');

    expect(resultado).toEqual({ ok: true });
    expect(engine.chamadas).toEqual([
      { projectId: PROJECT, sessionId: SESSION, agent: 'po' },
    ]);
  });

  // Ao contrário de SendAgentMessageUseCase/ConfirmReadinessUseCase, cancelar
  // NÃO grava chat.message nem marco nenhum no event log — o desfecho de
  // verdade (agent.error com origem "politica") é o PRÓPRIO engine quem
  // grava, no turno que ele matou. Duplicar aqui seria narrar o mesmo fato
  // duas vezes por dois autores diferentes.
  it('não grava evento nenhum — só sinaliza o engine', async () => {
    await uc.execute(PROJECT, SESSION, 'criativo');

    expect(engine.chamadas).toHaveLength(1);
  });

  it('propaga a falha de transporte do engine (o controller decide o status)', async () => {
    engine.falhar = true;

    await expect(uc.execute(PROJECT, SESSION, 'arquiteto')).rejects.toThrow(
      'engine fora do ar',
    );
  });
});
