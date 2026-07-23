import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import { ModelRepository } from '../../ports/model-repository.port';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';

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

    return this.bindings.upsert({ scope, scopeId, modelId, createdBy });
  }
}
