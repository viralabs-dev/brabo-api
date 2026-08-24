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
    description: 'Models to turn on or off. Whole batch or nothing.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  modelIds!: string[];

  @ApiProperty({
    example: true,
    description:
      '`true` makes the model appear in the selector and be able to receive ' +
      'a new binding. Does not touch `availability`, which is what sync ' +
      'observed on the provider.',
  })
  @IsBoolean()
  isActive!: boolean;
}
