/**
 * Do menos para o mais específico. `area` entrou na FASE 23 (ADR 0064) entre
 * `project` e `agent`: ela é o PADRÃO da área, e o binding do agente é a
 * divergência que o sobrepõe.
 */
export const MODEL_BINDING_SCOPES = [
  'workspace',
  'project',
  'area',
  'agent',
  'session',
] as const;

export type ModelBindingScope = (typeof MODEL_BINDING_SCOPES)[number];
