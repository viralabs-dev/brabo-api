import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { CatalogoDeAgentes } from '../../../../application/use-cases/agents/get-agent-catalog.use-case';
import type { Wire } from '../../shared/dto/wire';

export class FerramentaDoAgenteResponseDto {
  @ApiProperty({ example: 'write_file' })
  nome!: string;

  @ApiProperty({
    description: 'Description the model reads (pt-BR), cut at 1000 chars.',
  })
  descricao!: string;
}

export class InstrucoesDoProjetoResponseDto {
  @ApiProperty({ example: 3 })
  versao!: number;

  @ApiProperty({ description: 'Current instruction text, cut at 8000 chars.' })
  conteudo!: string;

  @ApiPropertyOptional({ description: 'Real length, present only when cut.' })
  conteudoTotal?: number;
}

export class AgenteDoCatalogoResponseDto {
  @ApiProperty({ example: 'dev-api' })
  agente!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Code identity; null when the engine is unreachable.',
  })
  identidade!: string | null;

  @ApiProperty({ type: InstrucoesDoProjetoResponseDto, nullable: true })
  instrucoesDoProjeto!: InstrucoesDoProjetoResponseDto | null;

  @ApiProperty({
    type: [FerramentaDoAgenteResponseDto],
    nullable: true,
    description:
      'FULL catalog; the per-step cut (Jev) may show less to the model. ' +
      'null = unknown (engine down), never "no tools".',
  })
  ferramentas!: FerramentaDoAgenteResponseDto[] | null;
}

export class CatalogoDeAgentesResponseDto implements Wire<CatalogoDeAgentes> {
  @ApiProperty({ type: [AgenteDoCatalogoResponseDto] })
  agentes!: AgenteDoCatalogoResponseDto[];

  @ApiPropertyOptional({ enum: ['engine_indisponivel'] })
  motivoSemCatalogo?: 'engine_indisponivel';
}
