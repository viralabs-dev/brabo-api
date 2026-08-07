import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import {
  AGENT_AREAS,
  areaDo,
  assertHandoffTargetAllowed,
  ehSubagente,
  HandoffToSubagentError,
} from '../../../src/domain/agents/agent-areas';

/**
 * Área, lead e membros são HARDCODED em três lugares (web, engine e agora
 * api) — o aparato genérico do ADR 0038 é corte de escopo registrado da Fase
 * 8, e continua cortado. O achado #4 do primeiro dogfooding já apontava o
 * risco: "dois lugares que podem divergir".
 *
 * Este teste não desfaz o corte. Ele apenas garante que a cópia nova não
 * divirja da do web em silêncio: se alguém acrescentar um subagente lá e
 * esquecer aqui, o handoff para ele passaria a ser aceito de novo — o defeito
 * volta calado, que é exatamente o que o achado descreve.
 */
function areasDoWeb(): { lead: string; members: string[] }[] {
  const caminho = join(
    __dirname,
    '../../../../../apps/web/src/lib/agents.ts',
  );
  const fonte = ts.createSourceFile(
    'agents.ts',
    readFileSync(caminho, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
  );

  const declaracao = fonte.statements
    .filter(ts.isVariableStatement)
    .flatMap((s) => s.declarationList.declarations)
    .find((d) => ts.isIdentifier(d.name) && d.name.text === 'AREAS');

  if (!declaracao?.initializer || !ts.isObjectLiteralExpression(declaracao.initializer)) {
    throw new Error('AREAS do web mudou de forma — ajuste este teste junto');
  }

  return declaracao.initializer.properties.flatMap((prop) => {
    if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) {
      return [];
    }

    const corpo = prop.initializer;
    const campo = (nome: string) =>
      corpo.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText() === nome,
      )?.initializer;

    const lead = campo('lead');
    const members = campo('members');

    return [
      {
        lead: lead ? lead.getText().replace(/['"]/g, '') : '',
        members:
          members && ts.isArrayLiteralExpression(members)
            ? members.elements.map((e) => e.getText().replace(/['"]/g, ''))
            : [],
      },
    ];
  });
}

describe('AGENT_AREAS não diverge do web', () => {
  it('mesmos leads e mesmos membros, na mesma ordem', () => {
    expect(
      AGENT_AREAS.map((a) => ({ lead: a.lead, members: [...a.members] })),
    ).toEqual(areasDoWeb());
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
