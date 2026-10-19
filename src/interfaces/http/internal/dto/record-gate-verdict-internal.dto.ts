import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
  MaxLength,
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
    enum: ['approved', 'changes_requested', 'needs_user_decision'],
    example: 'changes_requested',
    description:
      '`needs_user_decision` (QA only, RN-860): the cycle waits for the ' +
      "user's answer to an open question — it does not count as a correction.",
  })
  @IsIn(['approved', 'changes_requested', 'needs_user_decision'])
  veredito!: 'approved' | 'changes_requested' | 'needs_user_decision';

  @ApiProperty({
    example: 'Missing tests for the insufficient-stock path.',
  })
  @IsString()
  resumo!: string;

  @ApiProperty({
    example: ['No test for a nonexistent SKU'],
    description: 'What needs to change, item by item.',
  })
  @IsArray()
  @IsString({ each: true })
  itens!: string[];

  @ApiPropertyOptional({
    example: 'Should a nonexistent code answer 404?',
    description:
      'With `needs_user_decision`: the new open question (up to 500 chars).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pergunta?: string;

  @ApiPropertyOptional({
    example: '404 with a plain message.',
    description: "With `needs_user_decision`: the agent's suggestion.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  sugestao?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'With `needs_user_decision`: an EXISTING open question instead of a new one.',
  })
  @IsOptional()
  @IsUUID()
  openQuestionId?: string;

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
