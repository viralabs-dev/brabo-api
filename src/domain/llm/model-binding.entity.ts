import type { ModelBindingScope } from './model-binding-scope';

export interface ModelBinding {
  id: string;
  scope: ModelBindingScope;
  scopeId: string;
  modelId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
