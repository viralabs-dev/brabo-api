import type { Model, ModelComCuradoria } from '../../domain/llm/model.entity';
import type { UsoDeModelo } from '../../domain/llm/model-uses';

/**
 * A curadoria de modelo POR WORKSPACE (ADR 0049).
 *
 * Toda operação exige um `workspaceId` — não há sobrecarga "global". Era
 * exatamente a existência de uma versão sem workspace (`models.is_active`) que
 * fazia um owner do A decidir pelo B, e a porta é desenhada para que essa
 * chamada não exista para ser escrita por engano.
 *
 * **Ausência de linha é o desligado.** Não há terceiro estado "nunca
 * decidido": modelo que o sync descobriu não tem linha aqui, e por isso não
 * aparece em `listActive` — que é o que a RN-043 sempre quis dizer, agora sem
 * coluna nenhuma em `models`.
 */
export abstract class WorkspaceModelRepository {
  /** Só os que aquele workspace ativou — é o que o seletor mostra. */
  abstract listActive(workspaceId: string): Promise<Model[]>;

  /**
   * O catálogo inteiro com a curadoria DAQUELE workspace anexada. Modelo sem
   * linha vem `isActive: false`, e não some da lista: a tela de curadoria
   * existe justamente para mostrar o que ainda não foi ligado.
   */
  abstract listAllComCuradoria(
    workspaceId: string,
  ): Promise<ModelComCuradoria[]>;

  /** A resposta pontual para "este modelo está ligado aqui?". */
  abstract isActive(workspaceId: string, modelId: string): Promise<boolean>;

  /**
   * Liga ou desliga em lote. `curatedBy` é o usuário que decidiu — a linha
   * nascida da migração de dados é a única que fica sem dono.
   */
  abstract setActive(input: {
    workspaceId: string;
    modelIds: string[];
    isActive: boolean;
    curatedBy: string;
  }): Promise<number>;

  /**
   * Substitui os usos do lote — não faz merge. A tela manda a lista completa
   * que o usuário vê marcada, e um merge tornaria impossível DESmarcar um uso
   * sem uma segunda operação.
   *
   * Eixo separado de `setActive`: marcar "serve para código" não liga o modelo
   * no seletor. Um modelo que ganha linha aqui sem nunca ter sido ligado nasce
   * INATIVO, contra o default `true` da coluna — opinar sobre um modelo não é
   * autorizá-lo a gastar (RN-043).
   */
  abstract setUses(input: {
    workspaceId: string;
    modelIds: string[];
    uses: UsoDeModelo[];
    curatedBy: string;
  }): Promise<number>;
}
