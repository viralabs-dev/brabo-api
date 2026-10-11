import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

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
}
