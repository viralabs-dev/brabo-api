import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelRepository } from '../../ports/model-repository.port';
import { WorkspaceModelRepository } from '../../ports/workspace-model-repository.port';
import type { ModelComCuradoria } from '../../../domain/llm/model.entity';
import type { UsoDeModelo } from '../../../domain/llm/model-uses';

export interface SetModelUsesInput {
  workspaceId: string;
  modelIds: string[];
  /** A lista COMPLETA de usos daquele(s) modelo(s) — substitui, não soma. */
  uses: UsoDeModelo[];
  curatedBy: string;
}

/**
 * Marca para que o workspace usa cada modelo (curadoria por uso).
 *
 * Existe porque a faceta de capability responde metade da pergunta: o catálogo
 * prova que um modelo lê imagem, mas nenhum provider publica qual deles rende
 * no código DESTE time. Isso só se descobre usando — e é opinião, então mora na
 * curadoria por workspace (ADR 0049) e nunca em `models`.
 *
 * Mesma disciplina de lote do `SetModelsActiveUseCase`: id inexistente reprova
 * a chamada inteira em vez de aplicar metade.
 */
@Injectable()
export class SetModelUsesUseCase {
  constructor(
    private readonly models: ModelRepository,
    private readonly workspaceModels: WorkspaceModelRepository,
  ) {}

  async execute(input: SetModelUsesInput): Promise<ModelComCuradoria[]> {
    const encontrados = await Promise.all(
      input.modelIds.map((id) => this.models.findById(id)),
    );
    const faltando = input.modelIds.filter((_, i) => !encontrados[i]);
    if (faltando.length > 0) {
      throw new NotFoundException(
        `Modelo não encontrado: ${faltando.join(', ')}`,
      );
    }

    // Duplicata no corpo não é erro do usuário — é a mesma decisão dita duas
    // vezes; normalizar aqui evita gravar `['codigo','codigo']`.
    const uses = [...new Set(input.uses)];
    await this.workspaceModels.setUses({ ...input, uses });

    const pedidos = new Set(input.modelIds);
    const todos = await this.workspaceModels.listAllComCuradoria(
      input.workspaceId,
    );
    return todos.filter((m) => pedidos.has(m.id));
  }
}
