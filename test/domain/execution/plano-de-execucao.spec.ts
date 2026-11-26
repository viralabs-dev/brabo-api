import { describe, it, expect } from 'vitest';
import {
  idsDasTarefasDoPlano,
  lerPlanoDeExecucao,
  lerLevantamento,
  niveisDoPlano,
  type Levantamento,
} from '../../../src/domain/execution/plano-de-execucao';

// AT-274 (RN-678): o plano do Dev Lead atribui o módulo de cada tarefa, e o
// conjunto válido é o `module_map` vigente.
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const MAPA = [{ name: 'board-engine' }, { name: 'input-keyboard' }];
const DO_PROJETO = new Set([T1, T2]);

function plano(
  tarefas: unknown,
  modulos: unknown = [{ modulo: 'board-engine', agentes: 1, porque: 'x' }],
) {
  return { resumo: 'r', modulos, tarefas };
}

describe('lerPlanoDeExecucao (RN-678)', () => {
  it('caminho feliz: cada tarefa com módulo do module_map vira atribuição', () => {
    const r = lerPlanoDeExecucao(
      plano([
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard' },
      ]),
      MAPA,
      DO_PROJETO,
    );
    expect(r).toEqual({
      ok: true,
      modulos: ['board-engine'],
      tarefas: [
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard' },
      ],
    });
  });

  it('tarefa SEM módulo é recusada, nomeando a tarefa e os módulos válidos', () => {
    const r = lerPlanoDeExecucao(plano([{ taskId: T1 }]), MAPA, DO_PROJETO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain(`A tarefa ${T1} está sem módulo`);
    expect(r.motivo).toContain('board-engine, input-keyboard');
  });

  it('módulo FORA do module_map é recusado, nomeando o módulo', () => {
    const r = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'audio' }]),
      MAPA,
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('"audio"');
    expect(r.motivo).toContain('não está no module_map vigente');
  });

  it('módulo do PLANO fora do module_map também é recusado', () => {
    const r = lerPlanoDeExecucao(
      plano(
        [{ taskId: T1, modulo: 'board-engine' }],
        [{ modulo: 'audio', agentes: 1 }],
      ),
      MAPA,
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
  });

  it('plano sem `tarefas` é recusado', () => {
    expect(lerPlanoDeExecucao(plano(undefined), MAPA, DO_PROJETO).ok).toBe(
      false,
    );
    expect(lerPlanoDeExecucao(plano([]), MAPA, DO_PROJETO).ok).toBe(false);
  });

  it('tarefa repetida e tarefa de outro projeto são recusadas', () => {
    const repetida = lerPlanoDeExecucao(
      plano([
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T1, modulo: 'input-keyboard' },
      ]),
      MAPA,
      DO_PROJETO,
    );
    expect(repetida.ok).toBe(false);
    const alheia = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'board-engine' }]),
      MAPA,
      new Set([T2]),
    );
    expect(alheia.ok).toBe(false);
    if (alheia.ok) return;
    expect(alheia.motivo).toContain('não existe neste projeto');
  });

  it('sem module_map vigente nada passa', () => {
    const r = lerPlanoDeExecucao(
      plano([{ taskId: T1, modulo: 'board-engine' }]),
      [],
      DO_PROJETO,
    );
    expect(r.ok).toBe(false);
  });

  it('idsDasTarefasDoPlano só devolve uuids (o resto cai em "não existe")', () => {
    expect(
      idsDasTarefasDoPlano({
        tarefas: [{ taskId: T1 }, { taskId: 'não-é-uuid' }, {}],
      }),
    ).toEqual([T1]);
  });

  // RN-1004 (AT-742, ADR 0259)
  describe('fundação com dono', () => {
    const T3 = '33333333-3333-4333-8333-333333333333';
    const MAPA_25 = [
      { name: 'db', dependsOn: [] },
      { name: 'api', dependsOn: ['db'] },
      { name: 'deploy', dependsOn: ['api'] },
      { name: 'docs', dependsOn: [] },
    ];
    const TODAS = new Set([T1, T2, T3]);

    it('módulo sem tarefa de que outro com tarefa depende recusa nomeando o par', () => {
      const r = lerPlanoDeExecucao(
        plano([{ taskId: T1, modulo: 'deploy' }], []),
        MAPA_25,
        TODAS,
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toContain(
        'deploy depende de api, que ficou sem tarefa — crie a tarefa de fundação de api',
      );
    });

    it('com tarefa em db, api e deploy passa; folha sem tarefa (docs) segue legítima', () => {
      const r = lerPlanoDeExecucao(
        plano(
          [
            { taskId: T1, modulo: 'deploy' },
            { taskId: T2, modulo: 'api' },
            { taskId: T3, modulo: 'db' },
          ],
          [],
        ),
        MAPA_25,
        TODAS,
      );
      expect(r.ok).toBe(true);
    });

    // RN-1083 (AT-913): módulo ENTREGUE satisfaz a dependência.
    it('dependência entregue (tudo done) fora do plano passa; sem tarefa nenhuma segue recusada', () => {
      const so = plano([{ taskId: T1, modulo: 'deploy' }], []);
      const entregue = lerPlanoDeExecucao(so, MAPA_25, TODAS, new Set(['api']));
      expect(entregue.ok).toBe(true);
      const nunca = lerPlanoDeExecucao(so, MAPA_25, TODAS, new Set(['db']));
      expect(nunca.ok).toBe(false);
    });
  });
});

describe('lerPlanoDeExecucao: contrato do módulo usado (AT-981, RN-1004)', () => {
  const MAPA_DEP = [
    { name: 'agenda', dependsOn: [] },
    { name: 'cancelamento', dependsOn: ['agenda'] },
  ];
  const TAREFAS = [
    { taskId: T1, modulo: 'agenda' },
    { taskId: T2, modulo: 'cancelamento' },
  ];
  const ler = (contratos?: string[]) =>
    lerPlanoDeExecucao(
      plano(TAREFAS, []),
      MAPA_DEP,
      DO_PROJETO,
      new Set(),
      contratos === undefined ? undefined : new Set(contratos),
    );

  it('recusa nomeando os dois quando o módulo usado não tem contrato', () => {
    const r = ler([]);
    expect(r).toMatchObject({ ok: false });
    expect((r as { motivo: string }).motivo).toMatch(
      /agenda.*cancelamento.*contrato/,
    );
  });

  it('passa com o contrato vigente; o módulo folha não exige contrato', () => {
    expect(ler(['agenda']).ok).toBe(true);
  });

  it('sem o conjunto de contratos, não confere', () => {
    expect(ler(undefined).ok).toBe(true);
  });
});

// AT-990 (RN-1371/1373): grafo de tarefas, levantamento e níveis.
describe('plano com dependeDe e levantamento (AT-990)', () => {
  const lev = (expoe: string[] = [], consome: string[] = []): Levantamento => ({
    arquivos: [],
    expoe,
    consome,
    dependenciasNpm: [],
    aceite: 'ok',
  });
  const levs = (m: Record<string, Levantamento | null>) =>
    new Map(Object.entries(m));
  const rodar = (tarefas: unknown, l: Map<string, Levantamento | null>) =>
    lerPlanoDeExecucao(
      plano(tarefas),
      MAPA,
      DO_PROJETO,
      new Set(),
      undefined,
      l,
    );

  it('caminho feliz: dependeDe vira parte da atribuição', () => {
    const r = rodar(
      [
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard', dependeDe: [T1] },
      ],
      levs({ [T1]: lev(['A']), [T2]: lev([], ['A']) }),
    );
    expect(r).toMatchObject({
      ok: true,
      tarefas: [{ taskId: T1 }, { taskId: T2, dependeDe: [T1] }],
    });
  });

  it('ciclo é recusado, nomeado', () => {
    const r = rodar(
      [
        { taskId: T1, modulo: 'board-engine', dependeDe: [T2] },
        { taskId: T2, modulo: 'input-keyboard', dependeDe: [T1] },
      ],
      levs({ [T1]: lev(), [T2]: lev() }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('ciclo');
  });

  it('dependência fora do projeto é recusada', () => {
    const r = rodar(
      [
        {
          taskId: T1,
          modulo: 'board-engine',
          dependeDe: ['99999999-9999-4999-8999-999999999999'],
        },
      ],
      levs({ [T1]: lev() }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('não existe neste projeto');
  });

  it('tarefa sem levantamento é recusada quando há dependeDe', () => {
    const r = rodar(
      [
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard', dependeDe: [T1] },
      ],
      levs({ [T1]: lev(), [T2]: null }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('sem levantamento');
  });

  it('consome sem expoe no plano é recusado, nomeando a assinatura', () => {
    const r = rodar(
      [
        { taskId: T1, modulo: 'board-engine' },
        { taskId: T2, modulo: 'input-keyboard' },
      ],
      levs({ [T1]: lev(['B']), [T2]: lev([], ['A']) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('consome "A"');
  });

  it('aceita `depende_de` e lista ids de dependência no ids do plano', () => {
    expect(
      idsDasTarefasDoPlano({
        tarefas: [{ taskId: T1, depende_de: [T2] }],
      }).sort(),
    ).toEqual([T1, T2]);
  });

  it('lerLevantamento exige listas de texto e aceite', () => {
    expect(lerLevantamento({})).toBeNull();
    expect(
      lerLevantamento({
        arquivos: ['a'],
        expoe: [],
        consome: [],
        dependenciasNpm: [],
        aceite: 'x',
      }),
    ).not.toBeNull();
  });

  it('niveisDoPlano: por dependeDe, com fallback pelo módulo', () => {
    const n = niveisDoPlano(
      [
        { taskId: 'a', modulo: 'cadastro' },
        { taskId: 'b', modulo: 'agenda', dependeDe: ['a'] },
        { taskId: 'c', modulo: 'agenda', dependeDe: ['b'] },
        { taskId: 'd', modulo: 'agenda' },
      ],
      [{ name: 'cadastro' }, { name: 'agenda', dependsOn: ['cadastro'] }],
    );
    expect([n.get('a'), n.get('b'), n.get('c'), n.get('d')]).toEqual([
      0, 1, 2, 1,
    ]);
  });
});

// AT-1014 (RN-1509): toda tabela do contrato tem quem a crie no plano.
describe('tabela com dono no plano (AT-1014)', () => {
  const T3 = '33333333-3333-4333-8333-333333333333';
  const MAPA_T = [
    { name: 'acesso', dependsOn: [] },
    { name: 'cadastro', dependsOn: [] },
    { name: 'agenda', dependsOn: [] },
  ];
  const item = (tipo: 'tabela' | 'identidade', assinatura: string) => ({
    tipo,
    assinatura,
    descricao: '',
  });
  const CONTRATOS = [
    { modulo: 'acesso', expoe: [item('tabela', 'usuario(id)')] },
    {
      modulo: 'cadastro',
      expoe: [item('identidade', 'profissional.usuarioId -> usuario.id')],
    },
    { modulo: 'agenda', expoe: [item('tabela', 'agendamento(id)')] },
  ];
  const lev = (expoe: string[]): Levantamento => ({
    arquivos: [],
    expoe,
    consome: [],
    dependenciasNpm: [],
    aceite: 'ok',
  });
  const ids = new Set([T1, T2, T3]);
  const ler = (
    tarefas: { taskId: string; modulo: string }[],
    levs: Record<string, Levantamento | null>,
    entregues: string[] = [],
    contratos: typeof CONTRATOS | null = CONTRATOS,
  ) =>
    lerPlanoDeExecucao(
      plano(tarefas, []),
      MAPA_T,
      ids,
      new Set(entregues),
      undefined,
      new Map(Object.entries(levs)),
      contratos ?? undefined,
    );
  const TRES = [
    { taskId: T1, modulo: 'acesso' },
    { taskId: T2, modulo: 'cadastro' },
    { taskId: T3, modulo: 'agenda' },
  ];

  it('caso TP-01: acesso dono de usuario sem tarefa que crie a tabela é recusado', () => {
    const r = ler(TRES, {
      [T1]: lev(['login()']),
      [T2]: lev([]),
      [T3]: lev(['tabela agendamento']),
    });
    expect(r).toMatchObject({ ok: false });
    const motivo = (r as { motivo: string }).motivo;
    expect(motivo).toMatch(/Ninguém ficou responsável.*`usuario`.*`acesso`/);
    expect(motivo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('passa com `tabela usuario` e `tabela agendamento` no expoe', () => {
    const r = ler(TRES, {
      [T1]: lev(['Tabela usuario']),
      [T2]: lev([]),
      [T3]: lev(['tabela agendamento']),
    });
    expect(r.ok).toBe(true);
  });

  it('recusa a tabela do outro dono mesmo com a primeira em dia', () => {
    const r = ler(TRES, { [T1]: lev(['tabela usuario']) });
    expect((r as { motivo: string }).motivo).toMatch(/`agendamento`.*`agenda`/);
  });

  it('dono da tabela referenciada sem tarefa: recusa; entregue: passa', () => {
    const so = [{ taskId: T2, modulo: 'cadastro' }];
    const r = ler(so, {});
    expect((r as { motivo: string }).motivo).toMatch(
      /`cadastro`.*`usuario`.*`acesso`.*sem tarefa/,
    );
    expect(ler(so, {}, ['acesso']).ok).toBe(true);
  });

  it('sem contratos ou sem levantamentos, não confere o que não tem', () => {
    expect(ler(TRES, {}, [], null).ok).toBe(true);
    const r = lerPlanoDeExecucao(
      plano(TRES, []),
      MAPA_T,
      ids,
      new Set(),
      undefined,
      undefined,
      CONTRATOS,
    );
    expect(r.ok).toBe(true);
  });
});
