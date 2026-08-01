import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsBoolean, IsUUID } from 'class-validator';

/**
 * Ativação em LOTE, porque é assim que a curadoria acontece: depois de um sync
 * o owner marca de uma vez os modelos que quer ver no seletor (Fase 9c).
 */
export class SetModelsActiveDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b'],
    description: 'Modelos a ligar ou desligar. Lote inteiro ou nada.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  modelIds!: string[];

  @ApiProperty({
    example: true,
    description:
      '`true` faz o modelo aparecer no seletor e poder receber binding novo. ' +
      'Não mexe em `availability`, que é o que o sync observou no provider.',
  })
  @IsBoolean()
  isActive!: boolean;
}
