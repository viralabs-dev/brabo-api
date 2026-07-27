import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (DevAgentServer pega a próxima task do módulo).
export class ClaimTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'api',
    description: 'Só tarefas deste módulo entram no sorteio.',
  })
  @IsString()
  module!: string;

  @ApiProperty({ example: 'dev-api' })
  @IsString()
  agentId!: string;
}
