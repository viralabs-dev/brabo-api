export const MODEL_BINDING_SCOPES = [
  'workspace',
  'project',
  'agent',
  'session',
] as const;

export type ModelBindingScope = (typeof MODEL_BINDING_SCOPES)[number];
