import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsUUID } from 'class-validator';

export class MarkTaskInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({
    example: 'dev-api',
    description: 'Só o agente que reivindicou a tarefa pode movê-la.',
  })
  @IsString()
  agentId!: string;

  @ApiProperty({
    enum: ['todo', 'in_progress', 'in_review', 'done'],
    example: 'in_review',
  })
  @IsIn(['todo', 'in_progress', 'in_review', 'done'])
  status!: 'todo' | 'in_progress' | 'in_review' | 'done';
}
