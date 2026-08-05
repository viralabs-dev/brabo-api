import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  GATES_HUMANOS_IMUTAVEIS,
  gatesCobraveis,
  validarRegistro,
  type Gate,
  type GateRegistry,
} from '../../../src/domain/gates/gate-registry';

/**
 * O registro de gates, validado contra o ARQUIVO REAL.
 *
 * Um teste que só exercitasse fixtures provaria que o validador funciona e não
 * que o registro está certo — e o registro é o produto desta fase. É o primeiro
 * teste de YAML do repositório; o `.docmap.yml` até hoje é validado só pelo CI
 * rodando o próprio script.
 */

const RAIZ = join(__dirname, '../../../../..');
const CAMINHO = join(RAIZ, 'docs/gates.yml');

const registro = parse(readFileSync(CAMINHO, 'utf-8')) as GateRegistry;
const existe = (caminho: string) => existsSync(join(RAIZ, caminho));

function gate(id: string): Gate {
  const encontrado = registro.gates.find((g) => g.id === id);
  if (!encontrado) throw new Error(`gate ${id} não existe no registro`);
  return encontrado;
}

describe('docs/gates.yml — o arquivo real', () => {
  it('é válido: nenhum problema acumulado', () => {
    expect(validarRegistro(registro, existe)).toEqual([]);
  });

  it('declara os gates do fluxo que existem hoje', () => {
    const ids = registro.gates.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'acao-aprovada',
        'story-promovida',
        'plano-de-adocao',
        'qa-verificada',
        'secops-segura',
        // PR de INFRA tem caminho próprio e estava fora da lista original.
        'infra-qa-verificada',
        'infra-secops-segura',
        'merge-protegida',
        // Os do repositório (ADR 0030).
        'backmerge',
        'pr-no-lugar-certo',
        'aprovacoes-da-escada',
        'promocao-conferida',
      ]),
    );
  });

  /**
   * Dois gates que compartilham `event_types` precisam de filtros que os
   * separem — senão a "última passagem" de um reportaria a linha do outro.
   * Vale para qa/secops (`pr.gate_changed`) e para os dois de infra
   * (`infra.gate_changed`).
   */
  it('nenhum par (event_types + filtro) se repete entre gates', () => {
    const chaves = registro.gates
      .map((g) => g.evidencia)
      .filter((e) => e?.tipo === 'event_log')
      .map((e) => JSON.stringify([e.event_types, e.filtro ?? null]));

    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it('infra tem um gate por julgador, discriminados por payload', () => {
    const qa = gate('infra-qa-verificada').evidencia;
    const secops = gate('infra-secops-segura').evidencia;
    if (qa?.tipo !== 'event_log' || secops?.tipo !== 'event_log') {
      throw new Error('os dois deveriam ter evidência no event log');
    }
    expect(qa.event_types).toEqual(['infra.gate_changed']);
    expect(qa.filtro?.gate).toBe('qa');
    expect(secops.filtro?.gate).toBe('secops');
  });

  /**
   * O único gate de CI cuja decisão é de gente: ele conta assinaturas por
   * papel. Um registro que o marcasse como automático mentiria sobre o que a
   * escada de aprovação faz.
   */
  it('a escada de aprovação é o gate de CI com decisão humana', () => {
    expect(gate('aprovacoes-da-escada').aprovacao_humana).toBe(true);

    const outrosDeCi = registro.gates.filter(
      (g) => g.fluxo === 'ci' && g.id !== 'aprovacoes-da-escada',
    );
    expect(outrosDeCi.length).toBeGreaterThan(0);
    for (const g of outrosDeCi) expect(g.aprovacao_humana).toBe(false);
  });

  it('todo gate de CI aponta workflow e alvo existentes', () => {
    for (const g of registro.gates.filter((x) => x.fluxo === 'ci')) {
      const evidencia = g.evidencia;
      if (evidencia?.tipo !== 'ci') {
        throw new Error(`${g.id} deveria ter evidência de CI`);
      }
      expect(existe(evidencia.workflow!)).toBe(true);
      expect(existe(evidencia.arquivo)).toBe(true);
    }
  });

  /**
   * O produto desta fase é medir, e medir errado é pior que não medir. QA e
   * SecOps gravam o MESMO `pr.gate_changed`, e o mesmo tipo sai na ABERTURA do
   * gate sem `veredito` — sem o filtro, abertura contaria como passagem.
   */
  it('qa e secops se distinguem por filtro de payload, não por tipo', () => {
    const qa = gate('qa-verificada').evidencia;
    const secops = gate('secops-segura').evidencia;

    if (qa?.tipo !== 'event_log' || secops?.tipo !== 'event_log') {
      throw new Error('os dois deveriam ter evidência no event log');
    }

    expect(qa.event_types).toEqual(secops.event_types);
    expect(qa.filtro?.gate).toBe('qa');
    expect(secops.filtro?.gate).toBe('secops');
    expect(qa.filtro?.veredito).toBe('presente');
  });

  /** Os dois que não têm — e não podem ter — prova no event log. */
  it('merge-protegida prova por teste, e o teste existe', () => {
    const evidencia = gate('merge-protegida').evidencia;
    expect(evidencia?.tipo).toBe('teste');
    if (evidencia?.tipo === 'event_log') throw new Error('inesperado');
    expect(existe(evidencia!.arquivo)).toBe(true);
  });

  it('backmerge prova por CI, e o workflow existe', () => {
    const evidencia = gate('backmerge').evidencia;
    expect(evidencia?.tipo).toBe('ci');
    if (evidencia?.tipo === 'event_log') throw new Error('inesperado');
    expect(existe(evidencia!.workflow!)).toBe(true);
  });

  it('todo gate planned aponta o backlog e não é cobrado', () => {
    const planned = registro.gates.filter((g) => g.status === 'planned');
    expect(planned.length).toBeGreaterThan(0);
    for (const g of planned) expect(g.backlog).toBeTruthy();
    expect(gatesCobraveis(registro).map((g) => g.id)).not.toEqual(
      expect.arrayContaining(planned.map((g) => g.id)),
    );
  });
});

describe('validarRegistro — as invariantes', () => {
  function comGate(overrides: Partial<Gate>): GateRegistry {
    const base: Gate = {
      id: 'exemplo',
      fluxo: 'pr',
      dono: 'usuario',
      entrada: [],
      entregavel: 'algo',
      verificacao: 'script',
      severidade: 'warn',
      aprovacao_humana: false,
      status: 'planned',
    };
    return { version: 1, gates: [{ ...base, ...overrides }] };
  }

  const tipos = (r: GateRegistry) =>
    validarRegistro(r, () => true).map((p) => p.tipo);

  // RN-070
  it('gate block sem verificacao script é recusado', () => {
    const r = comGate({
      severidade: 'block',
      verificacao: 'humana',
      status: 'active',
      evidencia: { tipo: 'teste', arquivo: 'x.spec.ts' },
    });
    expect(tipos(r)).toContain('block-sem-script');
  });

  // RN-071
  it.each(GATES_HUMANOS_IMUTAVEIS)(
    '%s não pode ter aprovacao_humana false',
    (id) => {
      const r = comGate({
        id,
        aprovacao_humana: false,
        status: 'active',
        evidencia: { tipo: 'teste', arquivo: 'x.spec.ts' },
      });
      expect(tipos(r)).toContain('humano-imutavel-desligado');
    },
  );

  it('gate que não é constitucionalmente manual pode ser automático', () => {
    const r = comGate({
      id: 'qa-verificada',
      aprovacao_humana: false,
      status: 'active',
      evidencia: { tipo: 'event_log', event_types: ['pr.gate_changed'] },
    });
    expect(tipos(r)).not.toContain('humano-imutavel-desligado');
  });

  it('gate active sem evidência é recusado', () => {
    expect(tipos(comGate({ status: 'active' }))).toContain(
      'ativo-sem-evidencia',
    );
  });

  it('gate planned com evidência é recusado — não passou por nada ainda', () => {
    const r = comGate({
      status: 'planned',
      evidencia: { tipo: 'teste', arquivo: 'x.spec.ts' },
    });
    expect(tipos(r)).toContain('planned-com-evidencia');
  });

  it('evidência apontando para arquivo inexistente é recusada', () => {
    const r = comGate({
      status: 'active',
      evidencia: { tipo: 'teste', arquivo: 'nao/existe.spec.ts' },
    });
    expect(validarRegistro(r, () => false).map((p) => p.tipo)).toContain(
      'evidencia-inexistente',
    );
  });

  it('id duplicado é recusado', () => {
    const r = comGate({});
    r.gates.push({ ...r.gates[0] });
    expect(tipos(r)).toContain('id-duplicado');
  });

  it('entrada que nomeia gate inexistente é recusada', () => {
    const r = comGate({ entrada: ['qa-verificada'] });
    expect(tipos(r)).toContain('entrada-orfa');
  });

  it('entrada que nomeia ARTEFATO não é confundida com gate', () => {
    const r = comGate({ entrada: ['pr-aberta', 'proposed_action'] });
    expect(tipos(r)).not.toContain('entrada-orfa');
  });
});
