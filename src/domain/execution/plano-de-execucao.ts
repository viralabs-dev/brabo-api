/**
 * O plano de execução do Dev Lead (`propose_execution_plan`) como CONTRATO,
 * não só como texto para o humano ler (AT-263/AT-274, RN-677/678, ADR 0194).
 *
 * Desde a RN-678 o plano carrega, além de `modulos`/`resumo`, a lista
 * `tarefas` — `[{ taskId, modulo }]` —, e é por ela que cada tarefa ganha o
 * MÓDULO que decide qual `dev-<modulo>` a pega. Quem atribui é o Dev Lead
 * (decisão do dono, 01/10), e o conjunto válido é o `module_map` VIGENTE.
 *
 * Função PURA (zero IO): quem lê o `module_map` e as tarefas do projeto é o
 * chamador. Ela roda DUAS vezes, de propósito: na PROPOSTA
 * (`ProposeActionUseCase`, a recusa chega ao Dev Lead como resultado da
 * ferramenta) e na APROVAÇÃO (`ExecuteExecutionPlanUseCase`), porque o
 * `module_map` pode ter mudado entre as duas — e aprovar não pode gravar um
 * módulo que deixou de existir.
 */

export interface AtribuicaoDeTarefa {
  taskId: string;
  modulo: string;
  /** AT-990 (RN-1370): tarefas que precisam estar `done` antes desta. */
  dependeDe?: string[];
}

/** AT-990 (RN-1370): o levantamento que o Dev Lead grava na tarefa. */
export interface Levantamento {
  arquivos: string[];
  expoe: string[];
  consome: string[];
  dependenciasNpm: string[];
  aceite: string;
}

const listaDeTexto = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '')
    ? (v as string[]).map((x) => x.trim())
    : null;

/** Valida o corpo do levantamento; `null` quando não serve. */
export function lerLevantamento(bruto: unknown): Levantamento | null {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const arquivos = listaDeTexto(b.arquivos);
  const expoe = listaDeTexto(b.expoe);
  const consome = listaDeTexto(b.consome);
  const dependenciasNpm = listaDeTexto(b.dependenciasNpm);
  const aceite = typeof b.aceite === 'string' ? b.aceite.trim() : '';
  if (!arquivos || !expoe || !consome || !dependenciasNpm || aceite === '') {
    return null;
  }
  return { arquivos, expoe, consome, dependenciasNpm, aceite };
}

/**
 * AT-990 (RN-1373): nível topológico de cada tarefa pela `dependeDe` (0 = sem
 * dependência dentro do conjunto); a tarefa sem `dependeDe` herda o nível do
 * módulo — 1 + o maior nível dos módulos do `dependsOn` do mapa. Dependência
 * fora do conjunto não conta. Ciclo não derruba: o nível fica 0.
 */
export function niveisDoPlano(
  tarefas: ReadonlyArray<{
    taskId: string;
    modulo: string;
    dependeDe?: string[];
  }>,
  mapa: readonly ModuloDoMapa[] = [],
): Map<string, number> {
  const porId = new Map(tarefas.map((t) => [t.taskId, t]));
  const doMapa = new Map(mapa.map((m) => [m.name, m.dependsOn ?? []]));
  const nivelDoModulo = new Map<string, number>();
  const calcularModulo = (m: string, pilha: Set<string>): number => {
    const feito = nivelDoModulo.get(m);
    if (feito !== undefined) return feito;
    if (pilha.has(m)) return 0;
    pilha.add(m);
    const deps = (doMapa.get(m) ?? []).filter((d) =>
      tarefas.some((t) => t.modulo === d),
    );
    const n = deps.length
      ? 1 + Math.max(...deps.map((d) => calcularModulo(d, pilha)))
      : 0;
    pilha.delete(m);
    nivelDoModulo.set(m, n);
    return n;
  };
  const niveis = new Map<string, number>();
  const calcular = (id: string, pilha: Set<string>): number => {
    const feito = niveis.get(id);
    if (feito !== undefined) return feito;
    const t = porId.get(id);
    if (!t || pilha.has(id)) return 0;
    let n: number;
    if (t.dependeDe && t.dependeDe.length > 0) {
      pilha.add(id);
      const deps = t.dependeDe.filter((d) => porId.has(d));
      n = deps.length
        ? 1 + Math.max(...deps.map((d) => calcular(d, pilha)))
        : 0;
      pilha.delete(id);
    } else {
      n = calcularModulo(t.modulo, new Set());
    }
    niveis.set(id, n);
    return n;
  };
  for (const t of tarefas) calcular(t.taskId, new Set());
  return niveis;
}

/** Módulo do `module_map` vigente, com o que ele CONSOME (`dependsOn`). */
export interface ModuloDoMapa {
  name: string;
  dependsOn?: readonly string[];
}

export type LeituraDoPlano =
  | { ok: true; tarefas: AtribuicaoDeTarefa[]; modulos: string[] }
  | { ok: false; motivo: string };

/**
 * Lê `tarefas` (e os `modulos` do plano) e confere contra o `module_map`
 * vigente e contra as tarefas que existem NESTE projeto. A primeira recusa
 * vence, com motivo NOMEADO — tarefa sem módulo, módulo fora do `module_map`,
 * tarefa repetida, tarefa que não é deste projeto.
 */
export function lerPlanoDeExecucao(
  payload: unknown,
  mapa: readonly ModuloDoMapa[],
  tarefasDoProjeto: ReadonlySet<string>,
  // AT-913: módulos com tarefa e todas `done` — satisfazem a dependência.
  modulosEntregues: ReadonlySet<string> = new Set(),
  // AT-981 (RN-1004): módulos com contrato vigente do Arquiteto. `undefined`
  // não confere (chamador sem acesso aos contratos).
  modulosComContrato?: ReadonlySet<string>,
  // AT-990 (RN-1371): levantamento de cada tarefa do projeto (`null` = sem).
  // `undefined` não confere a `depende_de` nem o `consome`.
  levantamentos?: ReadonlyMap<string, Levantamento | null>,
): LeituraDoPlano {
  const modulosDoMapa = mapa.map((m) => m.name);
  const p = (payload ?? {}) as { tarefas?: unknown; modulos?: unknown };
  const validos = `módulos do module_map vigente: ${modulosDoMapa.join(', ') || '(nenhum)'}`;

  if (modulosDoMapa.length === 0) {
    return {
      ok: false,
      motivo:
        'O projeto não tem module_map vigente — o Arquiteto precisa definir os módulos antes de um plano de execução.',
    };
  }

  const modulos: string[] = [];
  if (Array.isArray(p.modulos)) {
    for (const item of p.modulos as unknown[]) {
      const modulo = (item as { modulo?: unknown } | null)?.modulo;
      if (typeof modulo === 'string' && modulo.trim() !== '') {
        if (!modulosDoMapa.includes(modulo)) {
          return {
            ok: false,
            motivo: `O plano cita o módulo "${modulo}", que não está no module_map vigente (${validos}).`,
          };
        }
        modulos.push(modulo);
      }
    }
  }

  if (!Array.isArray(p.tarefas) || p.tarefas.length === 0) {
    return {
      ok: false,
      motivo:
        'O plano precisa atribuir cada tarefa a um módulo em `tarefas` ([{ taskId, modulo }]) — sem isso nenhum dev agent sabe qual tarefa é dele.',
    };
  }

  const tarefas: AtribuicaoDeTarefa[] = [];
  const vistas = new Set<string>();
  for (const [indice, item] of (p.tarefas as unknown[]).entries()) {
    const bruto = (item ?? {}) as {
      taskId?: unknown;
      modulo?: unknown;
      dependeDe?: unknown;
      depende_de?: unknown;
    };
    const taskId = typeof bruto.taskId === 'string' ? bruto.taskId.trim() : '';
    if (taskId === '') {
      return {
        ok: false,
        motivo: `O item ${indice + 1} de \`tarefas\` não tem \`taskId\`.`,
      };
    }
    const modulo = typeof bruto.modulo === 'string' ? bruto.modulo.trim() : '';
    const dependeBruto = bruto.dependeDe ?? bruto.depende_de;
    const dependeDe = listaDeTexto(dependeBruto ?? []);
    if (dependeDe === null) {
      return {
        ok: false,
        motivo: `A tarefa ${taskId} tem \`dependeDe\` que não é uma lista de taskId.`,
      };
    }
    if (modulo === '') {
      return {
        ok: false,
        motivo: `A tarefa ${taskId} está sem módulo — toda tarefa do plano precisa de um (${validos}).`,
      };
    }
    if (!modulosDoMapa.includes(modulo)) {
      return {
        ok: false,
        motivo: `A tarefa ${taskId} está no módulo "${modulo}", que não está no module_map vigente (${validos}).`,
      };
    }
    if (vistas.has(taskId)) {
      return {
        ok: false,
        motivo: `A tarefa ${taskId} aparece mais de uma vez no plano — cada tarefa pertence a UM módulo.`,
      };
    }
    if (!tarefasDoProjeto.has(taskId)) {
      return {
        ok: false,
        motivo: `A tarefa ${taskId} não existe neste projeto.`,
      };
    }
    for (const d of dependeDe) {
      if (!tarefasDoProjeto.has(d)) {
        return {
          ok: false,
          motivo: `A tarefa ${taskId} depende de ${d}, que não existe neste projeto.`,
        };
      }
    }
    vistas.add(taskId);
    tarefas.push(
      dependeDe.length > 0 ? { taskId, modulo, dependeDe } : { taskId, modulo },
    );
  }

  // AT-990 (RN-1371): o grafo de tarefas. Ciclo, tarefa sem levantamento e
  // `consome` sem quem `expoe` no plano são recusas nomeadas.
  const ciclo = acharCiclo(tarefas);
  if (ciclo !== null) {
    return {
      ok: false,
      motivo: `\`dependeDe\` forma um ciclo: ${ciclo.join(' → ')}.`,
    };
  }
  if (levantamentos !== undefined) {
    const temDependencia = tarefas.some((t) => (t.dependeDe ?? []).length > 0);
    if (temDependencia) {
      const sem = tarefas.find((t) => !levantamentos.get(t.taskId));
      if (sem) {
        return {
          ok: false,
          motivo: `A tarefa ${sem.taskId} está sem levantamento — o plano com \`dependeDe\` exige o levantamento de cada tarefa (grave com levantar_tarefa).`,
        };
      }
    }
    const expostas = new Set(
      tarefas.flatMap((t) => levantamentos.get(t.taskId)?.expoe ?? []),
    );
    for (const t of tarefas) {
      const faltando = (levantamentos.get(t.taskId)?.consome ?? []).find(
        (c) => !expostas.has(c),
      );
      if (faltando !== undefined) {
        return {
          ok: false,
          motivo: `A tarefa ${t.taskId} consome "${faltando}", que nenhuma tarefa do plano expõe.`,
        };
      }
    }
  }

  // RN-1004 (AT-742, ADR 0259): módulo sem tarefa de que outro módulo COM
  // tarefa depende fica sem dono — o consumidor bloqueia sem contrato. Módulo
  // folha sem tarefa segue legítimo (RN-709). Módulo ENTREGUE (todas as
  // tarefas `done`, AT-913) satisfaz a dependência: só o que nunca teve tarefa
  // precisa da de fundação.
  const comTarefa = new Set(tarefas.map((t) => t.modulo));
  for (const m of mapa) {
    if (!comTarefa.has(m.name)) continue;
    const orfa = (m.dependsOn ?? []).find(
      (d) =>
        modulosDoMapa.includes(d) &&
        !comTarefa.has(d) &&
        !modulosEntregues.has(d),
    );
    if (orfa !== undefined) {
      return {
        ok: false,
        motivo: `${m.name} depende de ${orfa}, que ficou sem tarefa — crie a tarefa de fundação de ${orfa}.`,
      };
    }
  }

  // AT-981 (RN-1004): módulo de que outro módulo COM tarefa depende precisa
  // de contrato do Arquiteto; o plano não sobe antes dele.
  if (modulosComContrato !== undefined) {
    for (const m of mapa) {
      if (!comTarefa.has(m.name)) continue;
      const semContrato = (m.dependsOn ?? []).find(
        (d) => modulosDoMapa.includes(d) && !modulosComContrato.has(d),
      );
      if (semContrato !== undefined) {
        return {
          ok: false,
          motivo: `${semContrato} é usado por ${m.name} e não tem contrato do Arquiteto — peça com pedir_ao_arquiteto.`,
        };
      }
    }
  }

  return { ok: true, tarefas, modulos };
}

/** Primeiro ciclo de `dependeDe` entre as tarefas do plano, ou `null`. */
function acharCiclo(tarefas: readonly AtribuicaoDeTarefa[]): string[] | null {
  const deps = new Map(tarefas.map((t) => [t.taskId, t.dependeDe ?? []]));
  const estado = new Map<string, 1 | 2>(); // 1 = na pilha, 2 = visitada
  const pilha: string[] = [];
  const visitar = (id: string): string[] | null => {
    if (estado.get(id) === 2) return null;
    if (estado.get(id) === 1) return [...pilha.slice(pilha.indexOf(id)), id];
    estado.set(id, 1);
    pilha.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const c = visitar(d);
      if (c) return c;
    }
    pilha.pop();
    estado.set(id, 2);
    return null;
  };
  for (const id of deps.keys()) {
    const c = visitar(id);
    if (c) return c;
  }
  return null;
}

/** Os `taskId`s que o plano cita, para o chamador buscar só essas tarefas. */
export function idsDasTarefasDoPlano(payload: unknown): string[] {
  const tarefas = (payload as { tarefas?: unknown } | null)?.tarefas;
  if (!Array.isArray(tarefas)) return [];
  const uuid = (id: unknown): id is string =>
    typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id.trim());
  const ids = new Set<string>();
  for (const t of tarefas) {
    const b = (t ?? {}) as Record<string, unknown>;
    if (uuid(b.taskId)) ids.add(b.taskId.trim());
    // A dependência também precisa ser conferida contra o projeto.
    const deps = b.dependeDe ?? b.depende_de;
    if (Array.isArray(deps)) {
      for (const d of deps) if (uuid(d)) ids.add(d.trim());
    }
  }
  return [...ids];
}

/**
 * AT-991 (RN-1398/RN-1399): módulos cujo plano declara `agentes >= 2` (lote
 * disjunto, conferido pelo engine) E que têm ao menos 2 tarefas — o segundo dev
 * sem tarefa para pegar ficaria ocioso. Sobe no máximo UM extra (`dev-<m>-2`).
 */
export function modulosComSegundoDev(
  payload: unknown,
  tarefasPorModulo: Readonly<Record<string, number>>,
): string[] {
  const modulos = (payload as { modulos?: unknown } | null)?.modulos;
  if (!Array.isArray(modulos)) return [];
  const out = new Set<string>();
  for (const item of modulos) {
    const { modulo, agentes } = (item ?? {}) as {
      modulo?: unknown;
      agentes?: unknown;
    };
    if (
      typeof modulo === 'string' &&
      typeof agentes === 'number' &&
      agentes >= 2 &&
      (tarefasPorModulo[modulo] ?? 0) >= 2
    ) {
      out.add(modulo);
    }
  }
  return [...out];
}
