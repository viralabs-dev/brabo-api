import { Injectable } from '@nestjs/common';
import {
  searchHuggingFaceModels,
  type HuggingFaceModel,
} from '../../../../infrastructure/huggingface/huggingface-client';

export interface SearchHuggingFaceModelsInput {
  query: string;
  /**
   * `false` (default) mostra só publishers do allowlist curado — a mesma
   * régua de "curadoria manual sempre" do ADR 0042, aplicada ao SELO
   * "oficial" em vez de à ativação. `true` inclui publishers fora da lista,
   * cada um marcado `official: false` para a tela renderizar o aviso de
   * segurança — nunca oculto, sempre um aviso explícito de risco.
   */
  includeCommunity?: boolean;
  limit?: number;
}

/**
 * Busca modelos GGUF no Hugging Face Hub para o fluxo de pull (Project/
 * Workspace Settings). Filtra para OFICIAIS por padrão — puxar um modelo é
 * baixar e depois ATIVAR no catálogo (RequestModelPullUseCase/
 * ConfirmModelPullUseCase), e a superfície de risco por padrão deve ser a
 * fabricante conhecida, não qualquer reupload de terceiro.
 */
@Injectable()
export class SearchHuggingFaceModelsUseCase {
  async execute(
    input: SearchHuggingFaceModelsInput,
  ): Promise<HuggingFaceModel[]> {
    const resultados = await searchHuggingFaceModels({
      query: input.query,
      limit: input.limit,
    });

    if (input.includeCommunity) return resultados;
    return resultados.filter((modelo) => modelo.official);
  }
}
