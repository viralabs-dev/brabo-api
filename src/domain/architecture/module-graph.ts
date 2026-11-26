// Grafo de dependência de módulos (Fase 3b — Arquiteto). Um module_map é
// {modules:[{name, stack, responsibility, dependsOn[], resources?}]};
// `dependsOn` referencia o `name` de outro módulo. O mapa é rejeitado se tiver
// um ciclo de dependência. Puro, sem IO.

import type { RecursosDoContainer } from '../containers/project-container';

export interface ModuleNode {
  name: string;
  stack: string;
  responsibility: string;
  dependsOn: string[];
  /**
   * O que ESTE módulo precisa sozinho dentro do container (ADR 0199, RN-683).
   * Opcional: mapas anteriores não o têm, e módulo sem declaração conta com o
   * padrão de hoje na derivação do mínimo (`recursos-minimos.ts`).
   */
  resources?: RecursosDoContainer;
}

export class ModuleCycleError extends Error {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`module_map tem ciclo de dependência: ${cycle.join(' -> ')}`);
    this.name = 'ModuleCycleError';
    this.cycle = cycle;
  }
}

/**
 * Retorna o primeiro ciclo encontrado (lista de nomes, começando e terminando
 * no mesmo nó), ou `null` se o grafo é acíclico. DFS com pilha de recursão.
 * Arestas para módulos inexistentes são ignoradas aqui (a resolução de
 * módulos referenciados por stories é outra checagem — module-resolution.ts).
 */
export function detectCycle(modules: ModuleNode[]): string[] | null {
  const byName = new Map(modules.map((m) => [m.name, m]));
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const stack: string[] = [];

  function dfs(name: string): string[] | null {
    state.set(name, VISITING);
    stack.push(name);

    const node = byName.get(name);
    for (const dep of node?.dependsOn ?? []) {
      if (!byName.has(dep)) continue; // aresta pendurada — ignora aqui
      const depState = state.get(dep);
      if (depState === VISITING) {
        // Fecha o ciclo em `dep`.
        const from = stack.indexOf(dep);
        return [...stack.slice(from), dep];
      }
      if (depState !== DONE) {
        const found = dfs(dep);
        if (found) return found;
      }
    }

    stack.pop();
    state.set(name, DONE);
    return null;
  }

  for (const m of modules) {
    if (state.get(m.name) !== DONE) {
      const found = dfs(m.name);
      if (found) return found;
    }
  }
  return null;
}

export function assertNoCycle(modules: ModuleNode[]): void {
  const cycle = detectCycle(modules);
  if (cycle) throw new ModuleCycleError(cycle);
}

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** O comando cita o módulo (segmento de caminho ou argumento), AT-985. */
export function citaModulo(comando: string, nome: string): boolean {
  return new RegExp(`(^|[\\s/='"])${escapar(nome)}($|[\\s/'"])`).test(comando);
}

/**
 * AT-1016 (RN-1514): o módulo que SOBE o app. É o que o `run.app.command` cita
 * (um só); sem citação, o ÚNICO módulo que depende de outro e de que ninguém
 * depende. Sem `run.app` ou sem resposta única, `null` e tudo segue como antes.
 *
 * shortcut: projeto com dois apps (api + web) tem dois sumidouros e devolve
 * `null`; se isso aparecer, vira o campo `run.app.modulo`, declarado pela Infra.
 */
export function moduloDoPontoDeEntrada(
  mapa: readonly { name: string; dependsOn?: readonly string[] }[],
  comandoDoApp: string | undefined | null,
): string | null {
  if (!comandoDoApp) return null;
  const citados = mapa.filter((m) => citaModulo(comandoDoApp, m.name));
  if (citados.length === 1) return citados[0].name;
  const usados = new Set(mapa.flatMap((m) => m.dependsOn ?? []));
  const sumidouros = mapa.filter(
    (m) => (m.dependsOn ?? []).length > 0 && !usados.has(m.name),
  );
  return sumidouros.length === 1 ? sumidouros[0].name : null;
}
