import type { RoutingPreference } from '@brabo/shared';
import type { ModelBindingScope } from './model-binding-scope';

export interface ModelBinding {
  id: string;
  scope: ModelBindingScope;
  scopeId: string;
  modelId: string;
  /**
   * Critério de roteamento do hub (ADR 0166, RN-583). `null` = o hub decide.
   * Só existe para provider que declara `routingPreference`.
   */
  routingPreference: RoutingPreference | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
