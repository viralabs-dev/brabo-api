import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// RN-1018: o agente (Criativo ou PO) retira a regra obsoleta. A checagem do
// papel e da citação mora no caso de uso, para a recusa sair NOMEADA (`reason`).
export class RetireBusinessRuleInternalDto {
  @ApiProperty({ description: 'The session the retirement is logged in.' })
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty({
    example: 'criativo',
    description: 'Who retires. Only `criativo` and `po` are allowed (403).',
  })
  @IsString()
  @IsNotEmpty()
  agentRole!: string;

  @ApiProperty({ example: 'Replaced by the per-professional agenda rule.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'The existing, non-retired rule that replaces it. Stories citing the ' +
      'retired rule cite this one. Required when `questionId` is absent.',
  })
  @IsOptional()
  @IsString()
  replacedBy?: string;

  @ApiPropertyOptional({
    description:
      'An open question the user ALREADY answered (RN-859 standard). ' +
      'Required when `replacedBy` is absent.',
  })
  @IsOptional()
  @IsString()
  questionId?: string;
}

export class RetiredBusinessRuleResponseDto {
  @ApiProperty() ruleId!: string;

  @ApiProperty({ type: String, nullable: true })
  replacedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  questionId!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Stories whose citation of the rule was swapped or removed.',
  })
  storyIds!: string[];
}
