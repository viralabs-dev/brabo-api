import { Injectable, NotFoundException } from '@nestjs/common';
import { ModelRepository } from '../../ports/model-repository.port';
import { WorkspaceModelRepository } from '../../ports/workspace-model-repository.port';
import type { ModelComCuradoria } from '../../../domain/llm/model.entity';

export interface SetModelsActiveInput {
  workspaceId: string;
  modelIds: string[];
  isActive: boolean;
  /** Quem decidiu — a linha de curadoria guarda o autor (ADR 0049). */
  curatedBy: string;
}

/**
 * Curadoria do owner: liga ou desliga modelos do seletor DAQUELE workspace
 * (Fase 9c, RN-043; por workspace desde o ADR 0049).
 *
 * Um só e lote são a MESMA operação — a tela marca várias linhas de uma vez
 * depois de um sync, e um endpoint por id faria N chamadas para uma decisão
 * só.
 *
 * Não mexe em `availability`: aquele eixo é o que o sync observou no provider,
 * é global, e sobrescrevê-lo daqui faria um owner "reativar" um modelo que não
 * existe mais do outro lado — para todo mundo.
 */
@Injectable()
export class SetModelsActiveUseCase {
  constructor(
    private readonly models: ModelRepository,
    private readonly workspaceModels: WorkspaceModelRepository,
  ) {}

  async execute(input: SetModelsActiveInput): Promise<ModelComCuradoria[]> {
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

    await this.workspaceModels.setActive(input);

    // Relê a curadoria gravada em vez de montar a resposta com o `isActive`
    // que acabamos de mandar: o que a tela recebe é o estado do banco, não o
    // pretendido.
    const pedidos = new Set(input.modelIds);
    const todos = await this.workspaceModels.listAllComCuradoria(
      input.workspaceId,
    );
    return todos.filter((m) => pedidos.has(m.id));
  }
}
