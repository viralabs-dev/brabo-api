import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

// Chamada interna do engine (ferramenta create_epic do PO).
export class CreateEpicInternalDto {
  @ApiProperty({ format: 'uuid', example: '01JC4Z0000PROJETO0000000001' })
  @IsUUID()
  projectId!: string;

  @ApiProperty({ example: 'Carrinho de compras' })
  @IsString()
  title!: string;

  @ApiPropertyOptional({ example: 'Tudo que o comprador faz antes de pagar.' })
  @IsOptional()
  @IsString()
  description?: string;
}
