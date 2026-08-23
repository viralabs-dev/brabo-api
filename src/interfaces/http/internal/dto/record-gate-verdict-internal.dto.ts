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

export class RecordGateVerdictInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ format: 'uuid', example: '01JC4Z0000TAREFA00000000001' })
  @IsUUID()
  taskId!: string;

  @ApiProperty({ enum: ['qa', 'secops'], example: 'qa' })
  @IsIn(['qa', 'secops'])
  gate!: 'qa' | 'secops';

  @ApiProperty({
    enum: ['approved', 'changes_requested'],
    example: 'changes_requested',
  })
  @IsIn(['approved', 'changes_requested'])
  veredito!: 'approved' | 'changes_requested';

  @ApiProperty({
    example: 'Missing tests for the insufficient-stock path.',
  })
  @IsString()
  resumo!: string;

  @ApiProperty({
    example: ['No test for a non-existent SKU'],
    description: 'What needs to change, item by item.',
  })
  @IsArray()
  @IsString({ each: true })
  itens!: string[];

  @ApiPropertyOptional({
    example: 3,
    description:
      "Cap on round trips before the task becomes `blocked`. Omitted uses the domain's default.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCorrections?: number;
}
