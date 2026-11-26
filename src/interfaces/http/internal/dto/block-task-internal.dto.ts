import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import {
  FAILURE_ORIGINS,
  type FailureOrigin,
} from '../../../../domain/agents/failure-origin';

export class AcaoDoBloqueioDto {
  @ApiPropertyOptional({ example: 'concluir_sem_app', maxLength: 64 })
  id?: string;

  @ApiProperty({ example: 'Concluir sem subir o app', maxLength: 40 })
  rotulo!: string;

  @ApiProperty({
    example:
      'Conclua a tarefa sem subir o app; o teste de subida fica para o fim.',
    maxLength: 2000,
    description:
      'Free text that goes to the dev agent when the button is clicked (may be empty).',
  })
  orientacao!: string;
}

export class ExplicacaoDoBloqueioDto {
  @ApiPropertyOptional({ example: 'qa_instancia_indisponivel', maxLength: 64 })
  codigo?: string;

  @ApiProperty({
    example: 'O app não subiu no teste e o agente não sabe como seguir.',
    maxLength: 160,
    description:
      'One sentence for a non-programmer (no file names, ids or jargon).',
  })
  causa!: string;

  @ApiProperty({ type: [AcaoDoBloqueioDto], minItems: 1, maxItems: 2 })
  acoes!: AcaoDoBloqueioDto[];
}

export class BlockTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agentId!: string;

  @ApiProperty({ example: 'Gate correction cap reached.' })
  @IsString()
  reason!: string;

  @ApiProperty({
    example: 'Correction cycle exhausted without exit 0.',
    description:
      'Free-text diagnosis — a human detail of what happened, not the structured origin of the failure.',
  })
  @IsString()
  diagnosis!: string;

  @ApiPropertyOptional({
    enum: FAILURE_ORIGINS,
    example: 'infra',
    description:
      'The ORIGIN of the failure: `infra`, `modelo`, `codigo`, or `politica`. Never by elimination — this is the lesson ' +
      'from ADR 0020, taken up a level by the QA Lead in ADR 0038. Optional: not every call site knows the origin.',
  })
  @IsOptional()
  @IsIn(FAILURE_ORIGINS)
  origin?: FailureOrigin;

  @ApiPropertyOptional({
    type: ExplicacaoDoBloqueioDto,
    description:
      'Optional plain-language explanation (cause + 1..2 ready actions). Shape is NOT validated by the DTO: ' +
      'an explanation that breaks the language rule is discarded and the block still happens (RN-1527).',
  })
  @IsOptional()
  @IsObject()
  explicacao?: ExplicacaoDoBloqueioDto;
}
