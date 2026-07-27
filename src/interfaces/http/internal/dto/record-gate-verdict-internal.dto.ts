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
    example: 'Faltam testes para o caminho de estoque insuficiente.',
  })
  @IsString()
  resumo!: string;

  @ApiProperty({
    example: ['Sem teste para SKU inexistente'],
    description: 'O que precisa mudar, item a item.',
  })
  @IsArray()
  @IsString({ each: true })
  itens!: string[];

  @ApiPropertyOptional({
    example: 3,
    description:
      'Teto de idas e voltas antes de a tarefa virar `blocked`. Omitido usa o default do domínio.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxCorrections?: number;
}
