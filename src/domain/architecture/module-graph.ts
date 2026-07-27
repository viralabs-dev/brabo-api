// Grafo de dependência de módulos (Fase 3b — Arquiteto). Um module_map é
// {modules:[{name, stack, responsibility, dependsOn[]}]}; `dependsOn`
// referencia o `name` de outro módulo. O mapa é rejeitado se tiver um ciclo de
// dependência. Puro, sem IO.

export interface ModuleNode {
  name: string;
  stack: string;
  responsibility: string;
  dependsOn: string[];
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
