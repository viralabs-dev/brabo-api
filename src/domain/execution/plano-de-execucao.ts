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
  modulosDoMapa: readonly string[],
  tarefasDoProjeto: ReadonlySet<string>,
): LeituraDoPlano {
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
    const bruto = (item ?? {}) as { taskId?: unknown; modulo?: unknown };
    const taskId = typeof bruto.taskId === 'string' ? bruto.taskId.trim() : '';
    if (taskId === '') {
      return {
        ok: false,
        motivo: `O item ${indice + 1} de \`tarefas\` não tem \`taskId\`.`,
      };
    }
    const modulo = typeof bruto.modulo === 'string' ? bruto.modulo.trim() : '';
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
    vistas.add(taskId);
    tarefas.push({ taskId, modulo });
  }

  return { ok: true, tarefas, modulos };
}

/** Os `taskId`s que o plano cita, para o chamador buscar só essas tarefas. */
export function idsDasTarefasDoPlano(payload: unknown): string[] {
  const tarefas = (payload as { tarefas?: unknown } | null)?.tarefas;
  if (!Array.isArray(tarefas)) return [];
  return tarefas
    .map((t) => (t as { taskId?: unknown } | null)?.taskId)
    .filter(
      (id): id is string =>
        typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id.trim()),
    )
    .map((id) => id.trim());
}
