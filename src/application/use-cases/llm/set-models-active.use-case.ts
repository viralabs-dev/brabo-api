import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelRepository } from '../../ports/model-repository.port';
import type { Model } from '../../../domain/llm/model.entity';

export interface SetModelsActiveInput {
  modelIds: string[];
  isActive: boolean;
}

/**
 * Curadoria do owner: liga ou desliga modelos do seletor (Fase 9c, RN-041).
 *
 * Um só e lote são a MESMA operação — a tela de curadoria marca várias linhas
 * de uma vez depois de um sync, e um endpoint por id faria N chamadas para uma
 * decisão só.
 *
 * Não mexe em `availability`: aquele eixo é o que o sync observou no provider,
 * e sobrescrevê-lo daqui faria o owner "reativar" um modelo que não existe mais
 * do outro lado.
 */
@Injectable()
export class SetModelsActiveUseCase {
  constructor(private readonly models: ModelRepository) {}

  async execute(input: SetModelsActiveInput): Promise<Model[]> {
    const encontrados = await Promise.all(
      input.modelIds.map((id) => this.models.findById(id)),
    );
    const faltando = input.modelIds.filter((_, i) => !encontrados[i]);
    if (faltando.length > 0) {
      // Falha o lote inteiro em vez de aplicar parcialmente: a tela marcou N
      // linhas e precisa saber que nenhuma mudou, não descobrir depois que uma
      // ficou para trás.
      throw new NotFoundException(
        `Modelo não encontrado: ${faltando.join(', ')}`,
      );
    }

    await this.models.setActive(input.modelIds, input.isActive);

    const atualizados = await Promise.all(
      input.modelIds.map((id) => this.models.findById(id)),
    );
    return atualizados.filter((m): m is Model => m !== null);
  }
}
