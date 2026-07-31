import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ModelRepository } from '../../ports/model-repository.port';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';
import { assertModelFitsBindingScope } from '../../../domain/llm/model-capabilities';

@Injectable()
export class SetModelBindingUseCase {
  constructor(
    private readonly bindings: ModelBindingRepository,
    private readonly models: ModelRepository,
  ) {}

  async execute(
    scope: ModelBindingScope,
    scopeId: string,
    modelId: string,
    createdBy: string,
  ) {
    const model = await this.models.findById(modelId);
    if (!model) throw new NotFoundException('Modelo não encontrado');

    // Fase 9a (RN-038): um agente sem tool calling nativo falharia só lá na
    // frente, no ToolLoop, como "o modelo parou" — a lição do ADR 0020 é não
    // deixar a origem da falha para descobrir por eliminação.
    assertModelFitsBindingScope(model, scope);

    return this.bindings.upsert({ scope, scopeId, modelId, createdBy });
  }
}
