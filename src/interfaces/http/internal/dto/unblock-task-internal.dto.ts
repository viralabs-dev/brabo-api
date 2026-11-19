import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** RN-864 (AT-525): a retomada automática depois de falha passageira. */
export class UnblockTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'dev-api',
    description: 'The dev agent whose transient failure scheduled the retry.',
  })
  @IsString()
  agentId!: string;

  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'RN-1430: guidance recorded on the unblock event, same as the human one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  orientacao?: string;
}
