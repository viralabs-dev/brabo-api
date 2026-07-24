// Validação cruzada story↔module_map (Fase 3b): os módulos que uma story
// referencia (moduleIds = nomes) precisam existir no module_map vigente. Puro.

export class StoryModulesMissingError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `História referencia módulos inexistentes no module_map vigente: ${missing.join(', ')}`,
    );
    this.name = 'StoryModulesMissingError';
    this.missing = missing;
  }
}

export function missingModules(
  moduleIds: string[],
  moduleNames: readonly string[],
): string[] {
  const known = new Set(moduleNames);
  return moduleIds.filter((id) => !known.has(id));
}

export function allModulesResolved(
  moduleIds: string[],
  moduleNames: readonly string[],
): boolean {
  return missingModules(moduleIds, moduleNames).length === 0;
}

export function assertModulesResolved(
  moduleIds: string[],
  moduleNames: readonly string[],
): void {
  const missing = missingModules(moduleIds, moduleNames);
  if (missing.length > 0) {
    throw new StoryModulesMissingError(missing);
  }
}
