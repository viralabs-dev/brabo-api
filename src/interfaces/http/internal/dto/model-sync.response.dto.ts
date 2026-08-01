import { ApiProperty } from '@nestjs/swagger';
import { LLM_PROVIDER_NAMES } from '@brabo/shared';
import type { MesmasChaves, Wire } from '../../shared/dto/wire';
import type {
  ResultadoPorProvider,
  SyncModelCatalogResult,
} from '../../../../application/use-cases/llm/sync-model-catalog.use-case';

export class ResultadoPorProviderResponseDto implements Wire<ResultadoPorProvider> {
  @ApiProperty({ enum: LLM_PROVIDER_NAMES, example: 'openai' })
  provider!: Wire<ResultadoPorProvider>['provider'];

  @ApiProperty({
    example: 3,
    description:
      'Modelos que não existiam no banco. Entram INATIVOS — ativar é curadoria ' +
      'do owner (RN-043).',
  })
  descobertos!: number;

  @ApiProperty({
    example: 1,
    description:
      'Modelos que estavam `unavailable` e voltaram ao catálogo. O `isActive` ' +
      'deles não é tocado: a escolha do owner sobrevive à ausência.',
  })
  reencontrados!: number;

  @ApiProperty({
    example: 0,
    description:
      'Modelos que sumiram do catálogo remoto. Viram `unavailable` e NUNCA são ' +
      'deletados — bindings e histórico de custo apontam para eles.',
  })
  indisponibilizados!: number;

  @ApiProperty({
    required: false,
    enum: ['sem_capability', 'sem_credencial', 'falha'],
    description:
      'Presente quando o provider não foi sincronizado. Provider pulado não ' +
      'indisponibiliza nada: "não sei o que tem lá" não é "não tem nada lá".',
  })
  pulado?: Wire<ResultadoPorProvider>['pulado'];

  @ApiProperty({
    required: false,
    enum: ['infra', 'modelo'],
    description:
      'Só com `pulado: "falha"`. Vocabulário de origem do ADR 0020 — `infra` ' +
      'quando nem se chegou a falar com o provider, `modelo` quando ele ' +
      'respondeu recusando.',
  })
  origemDaFalha?: Wire<ResultadoPorProvider>['origemDaFalha'];

  @ApiProperty({ required: false, example: 'openai respondeu com status 401' })
  detalhe?: string;
}
export const _chavesResultadoPorProvider: MesmasChaves<
  ResultadoPorProviderResponseDto,
  ResultadoPorProvider
> = true;

export class SyncModelCatalogResponseDto implements Wire<SyncModelCatalogResult> {
  @ApiProperty({ type: [ResultadoPorProviderResponseDto] })
  porProvider!: ResultadoPorProviderResponseDto[];
}
export const _chavesSyncCatalogo: MesmasChaves<
  SyncModelCatalogResponseDto,
  SyncModelCatalogResult
> = true;
