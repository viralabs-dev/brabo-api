import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelRepository } from '../../ports/model-repository.port';
import type { Model, ModelBilling } from '../../../domain/llm/model.entity';

/**
 * Grava a marca CURADA de cobrança do modelo (AT-632, RN-954). Vale daqui em
 * diante: o relatório separa por ela, e a linha de `token_usage` não muda.
 */
@Injectable()
export class UpdateModelBillingUseCase {
  constructor(private readonly models: ModelRepository) {}

  async execute(modelId: string, billing: ModelBilling): Promise<Model> {
    if (!(await this.models.findById(modelId))) {
      throw new NotFoundException('Modelo não encontrado');
    }
    return this.models.setBilling(modelId, billing);
  }
}
