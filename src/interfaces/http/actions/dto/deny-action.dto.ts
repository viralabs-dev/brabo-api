import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DenyActionDto {
  @ApiPropertyOptional({
    example: 'O comando apagaria o diretório de trabalho.',
    description:
      'Fica no event log junto com a negativa. Opcional, mas recomendado.',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
