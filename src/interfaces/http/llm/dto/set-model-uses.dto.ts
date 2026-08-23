import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsUUID } from 'class-validator';
import {
  USOS_DE_MODELO,
  type UsoDeModelo,
} from '../../../../domain/llm/model-uses';

/**
 * Marca para que o workspace usa os modelos do lote (curadoria por uso).
 *
 * `uses` pode vir VAZIO — é como se desmarca tudo. Por isso não leva
 * `@ArrayNotEmpty`, ao contrário de `modelIds`: um lote sem modelo nenhum não
 * tem o que fazer, mas um modelo sem uso nenhum é um estado legítimo.
 */
export class SetModelUsesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    example: ['9b1c2d3e-4f50-4a61-8b72-0c3d4e5f6a7b'],
    description: 'Models to mark. Whole batch or nothing.',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  modelIds!: string[];

  @ApiProperty({
    enum: USOS_DE_MODELO,
    isArray: true,
    example: ['codigo', 'analise'],
    description:
      'The COMPLETE list of uses — replaces the previous one, does not add ' +
      'to it. An empty list unmarks all. A closed vocabulary: a use outside ' +
      'it fails the call, because free text would give `code`, `coding`, and ' +
      '`código` in the same filter.',
  })
  @IsArray()
  @IsIn(USOS_DE_MODELO, { each: true })
  uses!: UsoDeModelo[];
}
