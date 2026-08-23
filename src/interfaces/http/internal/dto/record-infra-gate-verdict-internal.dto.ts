import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';

export class RecordInfraGateVerdictInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '01JC4Z8QK3M7YV2N5T9B0PXHRD',
    description: 'The `open_infra_pr` `proposed_action` that opened the PR.',
  })
  @IsUUID()
  prActionId!: string;

  @ApiProperty({ enum: ['qa', 'secops'], example: 'secops' })
  @IsIn(['qa', 'secops'])
  gate!: 'qa' | 'secops';

  @ApiProperty({ enum: ['approved', 'changes_requested'], example: 'approved' })
  @IsIn(['approved', 'changes_requested'])
  veredito!: 'approved' | 'changes_requested';

  @ApiProperty({ example: 'Non-root image with no secret in ARG.' })
  @IsString()
  resumo!: string;

  @ApiProperty({ example: [] })
  @IsArray()
  @IsString({ each: true })
  itens!: string[];

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCorrections?: number;
}
