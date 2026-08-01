import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelRepository } from '../../ports/model-repository.port';
import { ModelPriceChangeRepository } from '../../ports/model-price-change-repository.port';
import { UnitOfWork } from '../../ports/unit-of-work.port';
import type { Model } from '../../../domain/llm/model.entity';
import type { PriceChangeSource } from '../../../domain/llm/model-price-change.entity';

export interface UpdateModelPricingInput {
  modelId: string;
  inputPricePerMillionMicros: number;
  outputPricePerMillionMicros: number;
  source: PriceChangeSource;
  /** `null` quando veio do sync — não há pessoa por trás. */
  changedBy: string | null;
}

/**
 * Muda o preço de um modelo e DEIXA RASTRO (Fase 9c, RN-042).
 *
 * O que o preço novo NÃO faz: reprecificar o passado. `token_usage` guarda o
 * custo já calculado E o preço que o produziu — mudar `models` daqui em diante
 * não toca em nenhuma linha de consumo, que é o que a Fase 9 registrou em "o
 * que NÃO fazer".
 *
 * Preço igual ao vigente é no-op silencioso: gravar uma linha de auditoria
 * "mudou de 10 para 10" transformaria o log em ruído e esconderia as mudanças
 * de verdade.
 */
@Injectable()
export class UpdateModelPricingUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly models: ModelRepository,
    private readonly priceChanges: ModelPriceChangeRepository,
  ) {}

  async execute(input: UpdateModelPricingInput): Promise<Model> {
    const antes = await this.models.findById(input.modelId);
    if (!antes) throw new NotFoundException('Modelo não encontrado');

    const semMudanca =
      antes.inputPricePerMillionMicros === input.inputPricePerMillionMicros &&
      antes.outputPricePerMillionMicros === input.outputPricePerMillionMicros;
    if (semMudanca) return antes;

    return this.unitOfWork.runInTransaction(async () => {
      const depois = await this.models.updatePricing(input.modelId, {
        inputPricePerMillionMicros: input.inputPricePerMillionMicros,
        outputPricePerMillionMicros: input.outputPricePerMillionMicros,
      });

      // Na MESMA transação: preço trocado sem linha de auditoria é exatamente
      // o buraco que a regra fecha.
      await this.priceChanges.record({
        modelId: input.modelId,
        inputBeforeMicros: antes.inputPricePerMillionMicros,
        inputAfterMicros: depois.inputPricePerMillionMicros,
        outputBeforeMicros: antes.outputPricePerMillionMicros,
        outputAfterMicros: depois.outputPricePerMillionMicros,
        source: input.source,
        changedBy: input.changedBy,
      });

      return depois;
    });
  }
}
