import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AGENT_AREAS,
  SOLO_CONVERSATIONAL_AGENTS,
  addressableAgents,
  areaDo,
  assertHandoffTargetAllowed,
  ehSubagente,
  HandoffToSubagentError,
} from '../../../src/domain/agents/agent-areas';
import {
  CAMINHO_ENGINE,
  CAMINHO_WEB,
  renderEngine,
  renderWeb,
} from '../../../scripts/gerar-areas';

/**
 * Área, lead e membros eram HARDCODED em três lugares (api, web e engine), e o
 * achado #4 do primeiro dogfooding já apontava o risco: "dois lugares que
 * podem divergir". A versão anterior deste teste lia a AST do web e comparava
 * com a lista daqui — travava DOIS dos três, e o engine podia divergir em
 * silêncio.
 *
 * A FASE 18 colapsou as três: esta é a fonte, e web e engine são gerados por
 * `pnpm --filter api gerar:areas`. O que este teste faz agora é provar que o
 * que está em disco É o que o gerador produz — sem isso, "derivado" seria só
 * uma intenção escrita no comentário.
 */
describe('as cópias derivadas não divergem da fonte (FASE 18)', () => {
  it('o arquivo do web é exatamente o que o gerador produz', () => {
    expect(readFileSync(CAMINHO_WEB, 'utf8')).toBe(renderWeb(AGENT_AREAS));
  });

  it('o módulo do engine é exatamente o que o gerador produz', () => {
    expect(readFileSync(CAMINHO_ENGINE, 'utf8')).toBe(
      renderEngine(AGENT_AREAS),
    );
  });

  it('área nova na fonte aparece nas duas derivadas — nenhuma some no caminho', () => {
    // A garantia que importa não é o texto, é a COBERTURA: subagente novo aqui
    // tem de virar alvo recusado no handoff (api), rótulo na tela (web) e
    // `Wake.subscribe` no lead (engine). Se o gerador deixasse um de fora, os
    // dois testes acima passariam felizes com a lista incompleta.
    const web = renderWeb(AGENT_AREAS);
    const engine = renderEngine(AGENT_AREAS);

    for (const area of AGENT_AREAS) {
      expect(web).toContain(`lead: '${area.lead}'`);
      expect(engine).toContain(`lead: "${area.lead}"`);

      for (const membro of area.members) {
        expect(web).toContain(`'${membro}'`);
        expect(engine).toContain(`"${membro}"`);
      }
    }
  });
});

describe('regra de alvo do handoff (ADR 0038)', () => {
  it('lead de área é alvo válido', () => {
    expect(() => assertHandoffTargetAllowed('qa')).not.toThrow();
    expect(() => assertHandoffTargetAllowed('infra')).not.toThrow();
  });

  it('agente sem área é alvo válido', () => {
    // O caso mais comum e o que a Fase 3 já fazia: Criativo → PO.
    expect(() => assertHandoffTargetAllowed('po')).not.toThrow();
    expect(() => assertHandoffTargetAllowed('arquiteto')).not.toThrow();
  });

  it('o dev de módulo DEIXOU de ser endereçável (FASE 14d)', () => {
    // Mudança deliberada do ADR 0053, e a linha deste teste que mudou de lado.
    // Enquanto não havia Dev Lead, `dev-api` era agente SEM área e por isso
    // alvo válido. Com a área de dev existindo, ele vira membro — e o único
    // endereço externo da execução passa a ser o lead.
    expect(() => assertHandoffTargetAllowed('dev-api')).toThrow(
      HandoffToSubagentError,
    );
    expect(() => assertHandoffTargetAllowed('dev-api-2')).toThrow(
      HandoffToSubagentError,
    );
  });

  it('`dev-lead` É endereçável, apesar do prefixo `dev-`', () => {
    // A ordem da checagem é o que garante isto: o lead é testado ANTES do
    // predicado de membro. Invertida, o lead da área ficaria inendereçável de
    // fora — o contrário do que o ADR quer.
    expect(() => assertHandoffTargetAllowed('dev-lead')).not.toThrow();
    expect(ehSubagente('dev-lead')).toBe(false);
    expect(areaDo('dev-lead')?.key).toBe('dev');
  });

  it('subagente NÃO é alvo — e o erro diz a quem falar', () => {
    expect(() => assertHandoffTargetAllowed('qa-automacao')).toThrow(
      HandoffToSubagentError,
    );

    try {
      assertHandoffTargetAllowed('qa-performance-seguranca');
      expect.unreachable('devia ter recusado o subagente');
    } catch (error) {
      expect(error).toBeInstanceOf(HandoffToSubagentError);
      // A mensagem precisa nomear o lead: recusar sem dizer o caminho certo
      // só transforma o furo de hierarquia em agente travado.
      expect((error as Error).message).toContain('qa');
    }
  });

  it('areaDo e ehSubagente concordam sobre quem é o quê', () => {
    expect(areaDo('qa')?.key).toBe('qa');
    expect(areaDo('infra-workflows')?.key).toBe('infra');
    expect(areaDo('criativo')).toBeUndefined();

    expect(ehSubagente('qa')).toBe(false);
    expect(ehSubagente('infra-workflows')).toBe(true);
    expect(ehSubagente('criativo')).toBe(false);
  });
});

/**
 * Handoff manual a agente à escolha (backlog, ADR 0109/RN-440):
 * `addressableAgents()` é o catálogo FECHADO que `RequestManualHandoffUseCase`
 * valida contra — leads de área ∪ agentes solo, nunca um subagente.
 */
describe('addressableAgents (ADR 0109)', () => {
  it('contém todo LEAD de área e todo agente solo, sem duplicata', () => {
    const catalogo = addressableAgents();

    for (const area of AGENT_AREAS) {
      expect(catalogo).toContain(area.lead);
    }
    for (const agente of SOLO_CONVERSATIONAL_AGENTS) {
      expect(catalogo).toContain(agente);
    }
    expect(new Set(catalogo).size).toBe(catalogo.length);
  });

  it('NUNCA contém um subagente de área', () => {
    const catalogo = addressableAgents();

    for (const area of AGENT_AREAS) {
      for (const membro of area.members) {
        expect(catalogo).not.toContain(membro);
      }
    }
    // `dev` é a área dinâmica (membros por module_map, não enumeráveis) —
    // a garantia estrutural é `ehDevDeModulo`, testada acima; aqui só o
    // caso concreto de exemplo.
    expect(catalogo).not.toContain('dev-api');
    expect(catalogo).not.toContain('qa-automacao');
  });

  it('inclui o Staff (ADR 0088) — o caso real que motivou esta feature', () => {
    expect(addressableAgents()).toContain('staff');
  });
});
