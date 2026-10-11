import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { menuComPiso, pisoDoMenu } from '../../../src/domain/llm/tool-router';

const GATES = join(__dirname, '../../../../engine/lib/engine/gates');
const PARECER: Array<[string, string, string]> = [
  ['qa-automacao', 'qa_automacao_agent.ex', 'emit_qa_verdict'],
  [
    'qa-performance-seguranca',
    'qa_performance_seguranca_agent.ex',
    'emit_perf_seguranca_verdict',
  ],
  ['qa-estrategia', 'qa_estrategia_agent.ex', 'emit_plano_de_teste'],
  ['appsec', 'appsec_agent.ex', 'emit_threat_model'],
];
const TODAS = PARECER.map(([, , t]) => t);

describe('piso de parecer dos agentes de gate (RN-840)', () => {
  it.each(PARECER)(
    '%s: id e ferramenta batem com o engine',
    (agente, arq, tool) => {
      const fonte = readFileSync(join(GATES, arq), 'utf8');
      expect(fonte).toContain(`agent: "${agente}"`);
      expect(fonte).toContain(`{:halted, {"${tool}"`);
    },
  );

  it.each(PARECER)(
    '%s: recorte só com terminal/read_file termina com o parecer',
    (agente, _arq, tool) => {
      const catalogo = ['terminal', 'read_file', 'search_workspace', ...TODAS];
      const menu = menuComPiso(catalogo, ['terminal', 'read_file'], agente);
      expect(menu).toEqual(['terminal', 'read_file', tool]);
      expect(pisoDoMenu(agente)).toEqual([tool]);
    },
  );

  it('nunca acrescenta ferramenta fora do catálogo do passo', () => {
    expect(
      menuComPiso(['terminal', 'read_file'], ['terminal'], 'qa-automacao'),
    ).toEqual(['terminal']);
  });

  it.each(['criativo', 'dev-api', 'dev-lead'])(
    '%s não ganha ferramenta de parecer',
    (agente) => {
      for (const t of TODAS) expect(pisoDoMenu(agente)).not.toContain(t);
    },
  );
});
