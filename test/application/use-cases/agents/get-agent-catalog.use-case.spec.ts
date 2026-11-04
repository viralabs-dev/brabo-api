import { describe, it, expect } from 'vitest';
import {
  GetAgentCatalogUseCase,
  TETO_DE_DESCRICAO,
  TETO_DE_INSTRUCAO,
} from '../../../../src/application/use-cases/agents/get-agent-catalog.use-case';
import type { ApiToEngineClient } from '../../../../src/application/ports/api-to-engine-client.port';
import type { AgentInstructionRepository } from '../../../../src/application/ports/agent-instruction-repository.port';

const linha = (agent: string, content: string, version = 2) => ({
  id: 'i',
  projectId: 'p',
  agent,
  content,
  version,
  createdAt: new Date(),
  updatedAt: new Date(),
});

function montar(engine: () => Promise<unknown>, linhas = [linha('po', 'x')]) {
  return new GetAgentCatalogUseCase(
    { getAgentCatalog: engine } as unknown as ApiToEngineClient,
    {
      listByProject: () => Promise.resolve(linhas),
    } as unknown as AgentInstructionRepository,
  );
}

describe('GetAgentCatalogUseCase (RN-995)', () => {
  it('junta identidade/ferramentas do engine com a instrução do projeto', async () => {
    const uc = montar(
      () =>
        Promise.resolve({
          agentes: [
            {
              agente: 'po',
              identidade: 'Sou o PO',
              ferramentas: [{ nome: 'a', descricao: 'd'.repeat(2000) }],
            },
            { agente: 'dev-*', identidade: 'Dev', ferramentas: [] },
          ],
        }),
      [linha('po', 'x'), linha('dev-api', 'y'.repeat(9000))],
    );
    const r = await uc.execute('p');
    const po = r.agentes.find((a) => a.agente === 'po')!;
    expect(po.identidade).toBe('Sou o PO');
    expect(po.instrucoesDoProjeto).toEqual({ versao: 2, conteudo: 'x' });
    expect(po.ferramentas![0].descricao).toHaveLength(TETO_DE_DESCRICAO);
    const dev = r.agentes.find((a) => a.agente === 'dev-api')!;
    expect(dev.identidade).toBe('Dev');
    expect(dev.instrucoesDoProjeto!.conteudo).toHaveLength(TETO_DE_INSTRUCAO);
    expect(dev.instrucoesDoProjeto!.conteudoTotal).toBe(9000);
    expect(r.agentes.some((a) => a.agente === 'dev-*')).toBe(false);
    expect(r.motivoSemCatalogo).toBeUndefined();
  });

  it('engine fora: null com motivo, instruções continuam (nunca "sem ferramentas")', async () => {
    const r = await montar(() => Promise.reject(new Error('fora'))).execute(
      'p',
    );
    expect(r.motivoSemCatalogo).toBe('engine_indisponivel');
    expect(r.agentes).toHaveLength(1);
    expect(r.agentes[0].ferramentas).toBeNull();
    expect(r.agentes[0].identidade).toBeNull();
    expect(r.agentes[0].instrucoesDoProjeto?.conteudo).toBe('x');
  });
});
