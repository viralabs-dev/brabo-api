import { ApiProperty } from '@nestjs/swagger';
import { LLM_PROVIDER_NAMES } from '../../../../domain/llm/llm-provider-names';
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
      'Models that did not exist in the database. They enter INACTIVE — ' +
      "activating is the owner's curation (RN-043).",
  })
  descobertos!: number;

  @ApiProperty({
    example: 1,
    description:
      'Models that were `unavailable` and came back to the catalog. Their ' +
      "`isActive` is left untouched: the owner's choice survives the absence.",
  })
  reencontrados!: number;

  @ApiProperty({
    example: 0,
    description:
      'Models that disappeared from the remote catalog. They become ' +
      '`unavailable` and are NEVER deleted — bindings and cost history point to them.',
  })
  indisponibilizados!: number;

  @ApiProperty({
    required: false,
    enum: ['sem_capability', 'sem_credencial', 'falha'],
    description:
      'Present when the provider was not synced. A skipped provider does not ' +
      'mark anything unavailable: "I don\'t know what\'s there" is not "there\'s nothing there".',
  })
  pulado?: Wire<ResultadoPorProvider>['pulado'];

  @ApiProperty({
    required: false,
    enum: ['infra', 'modelo'],
    description:
      'Only with `pulado: "falha"`. Origin vocabulary from ADR 0020 — `infra` ' +
      'when the provider was never even reached, `modelo` when it responded refusing.',
  })
  origemDaFalha?: Wire<ResultadoPorProvider>['origemDaFalha'];

  @ApiProperty({ required: false, example: 'openai responded with status 401' })
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
