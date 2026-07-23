import { Injectable } from '@nestjs/common';
import { ModelBindingRepository } from '../../ports/model-binding-repository.port';
import type { ModelBindingScope } from '../../../domain/llm/model-binding-scope';

@Injectable()
export class GetModelBindingUseCase {
  constructor(private readonly bindings: ModelBindingRepository) {}

  execute(scope: ModelBindingScope, scopeId: string) {
    return this.bindings.findOne(scope, scopeId);
  }
}
